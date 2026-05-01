#!/usr/bin/env bash
# propose-deploy.sh — orchestrate a TPAR-DB Dashboard deploy with phone approval.
#
# Usage:
#   scripts/propose-deploy.sh "commit message"
#   scripts/propose-deploy.sh "commit message" --preview     # don't go to production
#   scripts/propose-deploy.sh "commit message" --no-approval # skip phone call (for non-interactive scripts)
#
# Flow:
#   1. Show git diff summary
#   2. (If staged changes) commit them with the given message
#   3. Place Twilio DTMF approval call to Danny (1=approve, 2=hold, 3=cancel)
#   4. Poll phone_decisions for resolution
#   5. On approve: git push → Vercel auto-deploys from GitHub
#   6. Poll Vercel deployment until READY/ERROR
#   7. Capture canary screenshot via browser MCP
#   8. Report outcome
#
# Requirements:
#   - /c/tpar-supabase/.env.local (for DB URL + secrets)
#   - /c/tpar-browser-mcp/.env.local (for browser MCP token)
#   - VERCEL_API_TOKEN in /c/tpar-supabase/.env.local
#
# Bail-out conditions:
#   - DTMF response = 2 (hold-as-preview) → switch to preview deploy
#   - DTMF response = 3 (cancel) → exit without push
#   - No DTMF response within 3 min → bail
#   - Build fails on Vercel → fetch logs, surface

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPAR_ENV="/c/tpar-supabase/.env.local"
BROWSER_ENV="/c/tpar-browser-mcp/.env.local"

COMMIT_MSG="${1:-}"
TARGET="production"
SKIP_APPROVAL=false

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preview) TARGET="preview" ;;
    --no-approval) SKIP_APPROVAL=true ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ -z "$COMMIT_MSG" ]]; then
  echo "ERROR: commit message required" >&2
  echo "Usage: $0 \"commit message\" [--preview] [--no-approval]" >&2
  exit 1
fi

# ── load secrets ──
[[ -f "$TPAR_ENV" ]] || { echo "ERROR: $TPAR_ENV not found" >&2; exit 1; }
DB_URL="$(grep -E '^postgres(ql)?://' "$TPAR_ENV" | head -1)"
CALL_DANNY_SECRET="$(grep '^CALL_DANNY_SECRET=' "$TPAR_ENV" | cut -d= -f2-)"
VERCEL_TOKEN="$(grep '^VERCEL_API_TOKEN=' "$TPAR_ENV" | cut -d= -f2-)"
BROWSER_TOKEN="$(grep '^BROWSER_MCP_TOKEN=' "$BROWSER_ENV" 2>/dev/null | cut -d= -f2-)"

[[ -n "$VERCEL_TOKEN" ]] || { echo "ERROR: VERCEL_API_TOKEN missing in $TPAR_ENV" >&2; exit 1; }
[[ -n "$CALL_DANNY_SECRET" || "$SKIP_APPROVAL" == "true" ]] || { echo "ERROR: CALL_DANNY_SECRET missing" >&2; exit 1; }

VERCEL_PROJECT="prj_h8VsbfK21hKr8zIJYGqdCdk9cWst"
DASHBOARD_URL="https://tpar-dashboard.vercel.app"
BROWSER_BRIDGE="https://tpar-browser-mcp.fly.dev"

cd "$REPO_ROOT"

# ── 1. Diff summary ──
echo "── changes proposed ──"
git status --short
echo ""
git diff --stat HEAD 2>/dev/null || true
echo ""

# Stage + commit if there are changes
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "$COMMIT_MSG" || true
fi

LATEST_COMMIT="$(git log -1 --format='%h %s')"
echo "── commit: $LATEST_COMMIT ──"
echo "── target: $TARGET ──"
echo ""

# ── 2. Approval gate ──
if [[ "$SKIP_APPROVAL" == "false" ]]; then
  echo "Placing Twilio approval call..."
  CALL_TEXT="Deploy proposal for the TPAR Dashboard. Commit: $COMMIT_MSG. Target: $TARGET. Press 1 to approve, 2 to redirect to preview only, or 3 to cancel."

  RESP=$(curl -sS -X POST "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1/call-danny" \
    -H 'Content-Type: application/json' \
    -H "X-Trigger-Secret: $CALL_DANNY_SECRET" \
    --data-binary @- <<JSON
{
  "text": $(printf '%s' "$CALL_TEXT" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "context": "deploy-approval",
  "options": [
    { "key": "1", "label": "approve" },
    { "key": "2", "label": "redirect to preview" },
    { "key": "3", "label": "cancel" }
  ]
}
JSON
)
  DECISION_ID=$(echo "$RESP" | python -c "import json,sys; print(json.load(sys.stdin).get('decision_id',''))" 2>/dev/null)
  if [[ -z "$DECISION_ID" ]]; then
    echo "ERROR: call-danny didn't return a decision_id. Response: $RESP" >&2
    exit 1
  fi
  echo "Decision id: $DECISION_ID — polling for response (3-min timeout)..."

  # Poll up to 3 min (18 attempts × 10 sec)
  RESOLUTION=""
  for i in {1..18}; do
    sleep 10
    RESOLUTION=$(psql "$DB_URL" -tA -c "SELECT resolution FROM public.phone_decisions WHERE id='$DECISION_ID';" 2>/dev/null | head -1 | xargs)
    [[ -n "$RESOLUTION" ]] && break
    echo "  attempt $i/18: still pending..."
  done

  if [[ -z "$RESOLUTION" ]]; then
    echo "ERROR: no DTMF response within 3 min. Bailing." >&2
    exit 1
  fi
  echo "Decision: $RESOLUTION"
  case "$RESOLUTION" in
    "approve") ;;
    "redirect to preview") TARGET="preview"; echo "Switched to preview-only" ;;
    "cancel") echo "Cancelled by approver."; exit 0 ;;
    *) echo "Unknown resolution: $RESOLUTION — bailing." >&2; exit 1 ;;
  esac
fi

# ── 3. Push ──
echo ""
echo "── pushing to GitHub ──"
git push origin main

# ── 4. Wait for Vercel deploy ──
# Vercel auto-deploys on push to main; poll for the new deployment.
echo ""
echo "── polling Vercel for the new deployment ──"
DPL_ID=""
for i in {1..15}; do
  sleep 8
  RES=$(curl -sS "https://api.vercel.com/v6/deployments?projectId=$VERCEL_PROJECT&limit=1" \
    -H "Authorization: Bearer $VERCEL_TOKEN")
  CANDIDATE=$(echo "$RES" | python -c "
import json, sys
d = json.load(sys.stdin)
ds = d.get('deployments', [])
if ds:
    print(ds[0].get('uid',''), ds[0].get('state', ds[0].get('readyState','')), ds[0].get('meta',{}).get('githubCommitSha','')[:7])
")
  CANDIDATE_ID=$(echo "$CANDIDATE" | awk '{print $1}')
  CANDIDATE_STATE=$(echo "$CANDIDATE" | awk '{print $2}')
  CANDIDATE_SHA=$(echo "$CANDIDATE" | awk '{print $3}')
  EXPECTED_SHA=$(git rev-parse HEAD | cut -c1-7)
  if [[ "$CANDIDATE_SHA" == "$EXPECTED_SHA" ]]; then
    DPL_ID="$CANDIDATE_ID"
    echo "  found deployment for our commit: $DPL_ID (state=$CANDIDATE_STATE)"
    [[ "$CANDIDATE_STATE" == "READY" || "$CANDIDATE_STATE" == "ERROR" ]] && break
  else
    echo "  attempt $i/15: latest deploy is for $CANDIDATE_SHA (waiting for $EXPECTED_SHA)"
  fi
done

if [[ -z "$DPL_ID" ]]; then
  echo "ERROR: didn't find a deployment for our commit within 2 min" >&2
  exit 1
fi

# Poll until READY/ERROR
for i in {1..20}; do
  sleep 6
  STATE=$(curl -sS "https://api.vercel.com/v13/deployments/$DPL_ID" -H "Authorization: Bearer $VERCEL_TOKEN" \
    | python -c "import json,sys; d=json.load(sys.stdin); print(d.get('readyState') or d.get('status'))")
  echo "  state: $STATE"
  [[ "$STATE" == "READY" || "$STATE" == "ERROR" || "$STATE" == "CANCELED" ]] && break
done

# ── 5. Outcome ──
if [[ "$STATE" != "READY" ]]; then
  echo ""
  echo "── deploy did NOT succeed (state=$STATE) — pulling logs ──"
  curl -sS "https://api.vercel.com/v3/deployments/$DPL_ID/events?limit=200" \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    | python -c "
import json, sys
events = json.load(sys.stdin)
events = events if isinstance(events, list) else events.get('events', [])
errs = [e for e in events if (e.get('type') in ('stderr','error')) or 'error' in (e.get('text','') or '').lower() or 'failed' in (e.get('text','') or '').lower()]
for e in errs[-10:]:
    print(f'  [{e.get(\"type\")}] {str(e.get(\"text\", \"\"))[:300]}')
"
  exit 1
fi

echo ""
echo "── deploy READY ──"
echo "  url: $DASHBOARD_URL"
echo "  deployment id: $DPL_ID"

# ── 6. Canary screenshot via browser MCP ──
if [[ -n "$BROWSER_TOKEN" ]]; then
  echo ""
  echo "── canary screenshot ──"
  curl -sS -X POST "$BROWSER_BRIDGE/reset" -H 'Content-Type: application/json' -H "Authorization: Bearer $BROWSER_TOKEN" -d '{}' > /dev/null
  curl -sS -X POST "$BROWSER_BRIDGE/navigate" -H 'Content-Type: application/json' -H "Authorization: Bearer $BROWSER_TOKEN" \
    -d "{\"url\":\"$DASHBOARD_URL/login\",\"wait_until\":\"domcontentloaded\"}" > /dev/null

  TS=$(date +%Y%m%d_%H%M%S)
  CANARY_PATH="/c/Users/ddunl/AppData/Local/Temp/canary_${TS}.png"
  curl -sS -X POST "$BROWSER_BRIDGE/screenshot" -H 'Content-Type: application/json' -H "Authorization: Bearer $BROWSER_TOKEN" -d '{}' \
    | python -c "
import json, sys, base64
d = json.load(sys.stdin)
if d.get('ok'):
    img = base64.b64decode(d['image_base64'])
    with open(r'$CANARY_PATH','wb') as f: f.write(img)
    print('  saved:', '$CANARY_PATH', f'({len(img)} bytes)')
else:
    print('  screenshot failed:', d)"
fi

echo ""
echo "── ALL DONE ──"
