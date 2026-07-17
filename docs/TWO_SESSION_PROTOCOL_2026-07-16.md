# Two-Session Protocol — one commitment path, low exposure, full transparency
*Danny, 2026-07-16: "2 conversations, one commitment path, low exposure, full
transparency, and upon request one can enter the other." This doc is the
contract. Canonical copy: `C:\tpar-supabase\docs\`; pointer copy in
`C:\tpar-dashboard\docs\`. It supersedes the single-sole-editor rule
(feedback_sole_editor_session_2026-07-13) — the sole-editor idea survives, but
scoped PER REPO instead of per company.*

## The sessions
- **NewDD** — the long-running build session (cwd `C:\tpar-supabase`).
- **RWD** ("Revise work description") — the second build session.
- Others (Checkinitallout, etc.) stay read-only planners unless granted a baton.
- **Danny is the consent authority.** Every baton handover and every entry into
  another session's context happens because he said so, in the session that acts.

## One commitment path (git is the ledger)
1. **One main branch per repo.** No session branches. Small commits.
2. **Push immediately after committing.** An unpushed commit is invisible to the
   other session — pushing IS the transparency.
3. **Pull before your first edit of a work block.** Cheap, and it makes the
   other session's finished work your starting truth.
4. Live-DB changes follow the existing laws regardless of session: migrations
   applied via MCP + repo-parity file in the same push; edge functions deploy
   only from `C:\tpar-supabase` working tree AFTER a pull (a deploy clobbers the
   whole function — the repo file must be the union of everyone's work).

## Low exposure (the baton — one writer per repo at a time)
- Each repo root carries an untracked, gitignored **`.editor-baton.json`**:
  `{ "holder": "NewDD" | "RWD" | "free", "taken_at": "...", "note": "..." }`.
  Both sessions share the same working trees on this machine, so the file is
  instantly visible to both — no sync needed.
- **Read the baton before editing, building, committing, or deploying in a
  repo.** If you don't hold it, you don't write — you ferry a proposal instead.
- Take it only when it's `free` or Danny hands it over; **release (set `free`,
  push your commits) at the end of a work block**, not days later.
- Why per-REPO and not per-file: `npm run build`, the git index, and deploys
  read the whole tree. Two writers in one repo = build races, index.lock
  fights, and half-edited deploys — the exact incidents the old sole-editor
  rule existed to prevent.
- The **dev bridge** (phone tether) counts as a writer: it only runs when
  NewDD holds no baton work in flight (existing 7/15 rule, unchanged).

## Full transparency (shared substrates)
- **`docs/SESSION_HANDOFF_LOG.md`** (tracked, append-only, in each repo): one
  line on every baton take/release — who, when, what, what's still in flight.
  This is the "what is the other one doing?" answer at a glance.
- **Git log** — pushed commits are the finished-work feed.
- **`docs/CONVERSATION_TRANSFER_CANVAS.txt`** — the curated ferry for
  in-flight thinking (Danny drops either session's work here for the other).
- **Memory:** both sessions in `C:\tpar-supabase` share one auto-memory dir.
  Topic-file writes are safe from either. **Only the session Danny designates
  (currently NewDD) compacts/restructures `MEMORY.md`** — a compaction while
  the other session is mid-write is the one real clobber risk (observed
  benignly 7/16). RWD adds pointers, never reorganizes.

## Entering the other session (consent-gated, two levels)
1. **Read-entry** — with Danny's go, either session may read the other's
   transcript directly: `C:\Users\ddunl\.claude\projects\<project-dir>\<id>.jsonl`
   (newest = active). Read the TAIL first; these files are large. This is
   full-fidelity "see exactly where the other one is."
2. **Write-entry (continuation)** — Danny says "take over X": the holding
   session releases the baton + appends a handoff line + (optionally) Danny
   ferries the canvas; the entering session pulls, takes the baton, and
   continues the work as its own. Nothing merges contexts — the ledger (git +
   log + canvas + transcript) IS the continuity.

## Standing division (default, Danny can reassign any time)
- **NewDD:** `tpar-supabase` (functions, migrations, crons, cfo, docs) +
  cross-repo waves when it holds both batons.
- **RWD:** `tpar-dashboard` builds it originates (e.g. the gallery framework
  UI), taking the supabase baton only for its migrations/RPCs — or handing
  those to NewDD via the log.
- Cross-repo features name their baton plan in the spec before building.
