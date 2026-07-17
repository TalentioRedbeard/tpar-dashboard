// Probe: stage-duration views parity + lockdown (acceptance 1, 5, 7 of the
// trigger-clocks spec, tpar-supabase docs/SPEC_2026-07-17_TRIGGER_STAGE_CLOCKS.md).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY.
const URL_ = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sr = (path) => fetch(`${URL_}/rest/v1/${path}`, {
  headers: { apikey: SR, Authorization: `Bearer ${SR}` },
}).then((r) => r.json());

let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

// Fixture: the most recent dashboard-origin press's job.
const [recent] = await sr(
  "job_lifecycle_events?origin=eq.dashboard&hcp_job_id=not.is.null&order=fired_at.desc&limit=1&select=hcp_job_id",
);
const job = recent?.hcp_job_id;
check("fixture job found", !!job, job);

// 1. Parity: recompute canon+lead in JS from raw events, compare to the view.
const raw = await sr(
  `job_lifecycle_events?hcp_job_id=eq.${job}&select=trigger_number,trigger_name,fired_at,origin`,
);
const byTrig = new Map();
for (const r of raw) {
  const cur = byTrig.get(r.trigger_number);
  const better = !cur
    || (cur.origin === "hcp_derived" && r.origin !== "hcp_derived")
    || (((cur.origin === "hcp_derived") === (r.origin === "hcp_derived")) && r.fired_at > cur.fired_at);
  if (better) byTrig.set(r.trigger_number, r);
}
const canon = [...byTrig.values()].sort((a, b) =>
  a.fired_at < b.fired_at ? -1 : a.fired_at > b.fired_at ? 1 : a.trigger_number - b.trigger_number);
// order must include the trigger_number tie-break (matches the view's lead()
// ordering) — batch hcp_derived inserts can share one statement's now().
const view = await sr(`job_stage_durations_v?hcp_job_id=eq.${job}&order=fired_at,trigger_number&select=*`);
check("view row count matches canon", view.length === canon.length, `${view.length} vs ${canon.length}`);
for (let i = 0; i < canon.length; i++) {
  const expEnd = i + 1 < canon.length ? canon[i + 1].fired_at : null;
  const expSec = expEnd ? Math.round((Date.parse(expEnd) - Date.parse(canon[i].fired_at)) / 1000) : null;
  const v = view[i];
  check(`stage ${canon[i].trigger_number} seconds`,
    v?.trigger_number === canon[i].trigger_number && (v?.stage_seconds ?? null) === expSec,
    `view=${v?.stage_seconds} expected=${expSec}`);
}

// 2. Rollup coherence.
const [roll] = await sr(`job_stage_rollup_v?hcp_job_id=eq.${job}&select=*`);
if (roll?.started_at && roll?.finished_at) {
  const exp = Math.round((Date.parse(roll.finished_at) - Date.parse(roll.started_at)) / 1000);
  check("rollup onsite_seconds", roll.onsite_seconds === exp, `${roll.onsite_seconds} vs ${exp}`);
} else {
  console.log("SKIP  rollup onsite (job lacks start+finish)");
}

// 3. Lockdown: anon must be denied on both views.
for (const v of ["job_stage_durations_v", "job_stage_rollup_v"]) {
  const res = await fetch(`${URL_}/rest/v1/${v}?limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  const body = await res.json().catch(() => null);
  const denied = res.status === 401 || res.status === 403
    || (body && !Array.isArray(body) && `${body.message ?? ""}`.includes("permission"));
  check(`anon denied on ${v}`, denied, `status ${res.status}`);
}

process.exit(fail ? 1 : 0);
