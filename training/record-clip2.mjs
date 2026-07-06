// Clip 2 — "Clocking in + your status buttons" (~65s). Beats match
// narration/clip-2-clock-status.md; manifest → videos/clock-status-beats.json.
//
// Usage:  node record-clip2.mjs <hashed_token from auth admin generate_link>
//
// REALITY DEVIATION (verified 2026-07-06, do not "fix" by faking): test-tech Al
// has ZERO jobs/appointments (job_360 + appointments_master both empty for Al),
// and /job/[id] hard-gates techs to jobs they were on (app/job/[id]/page.tsx
// ~L196) — so the real job-page trigger bar CANNOT be filmed as Al. Per the
// storyboard's sanctioned fallback we film the surfaces that describe the
// buttons instead:
//   b1  /me — the clock section (SPOTLIGHT ONLY — never press Clock in/out)
//   b2  /me — "Your day, the basics" → the "Press your status buttons" card
//       (names the exact four: On My Way → Start → Finish → Collect)
//   b3  /how-to — the "what one trigger press fans out to" figure
//       (customer heads-up · HCP status · your day's timeline)
//   b4  /me — the "Clock in when you start" basics card (the GPS assist),
//       park + close
//
// GUARDRAIL: no clicks anywhere in this clip — spotlight only.

import { createRecorder, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-clip2.mjs <hashed_token>"); process.exit(1); }

const D = loadDurations("clip-2-clock-status");
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "clock-status", hashedToken, startPath: "/me" });
const { page } = r;

// ── b1: the clock, on My Day ─────────────────────────────────────────────────
await r.beat("b1");
{
  const total = durMs("b1", 14.5);
  await sleep(1200); // let the opening line land on the untouched page
  const clockCard = page.locator("section", { has: page.getByRole("button", { name: /clock (in|out)/i }) }).first();
  await r.spotlight(clockCard, { hold: total - 3300, shot: "b1-clock" });
}

// ── b2: the status buttons — the basics card that names all four ────────────
await r.beat("b2");
{
  const total = durMs("b2", 16.8);
  const statusCard = page.getByText("Press your status buttons").first().locator("xpath=ancestor::li[1]");
  await r.spotlight(statusCard, { hold: total - 2200, pulses: 4, shot: "b2-status-card" });
}

// ── b3: why it matters — the trigger-press fan-out figure on /how-to ────────
await r.gotoAndSettle("/how-to", 1800);
await r.beat("b3");
{
  const total = durMs("b3", 14.7);
  const flow = page.locator('svg[aria-label="What one trigger press fans out to"]').first()
    .locator("xpath=ancestor::div[1]");
  await r.spotlight(flow, { hold: total - 2800, shot: "b3-trigger-flow" });
}

// ── b4: the GPS assist + close — back on /me, the clock-in basics card ──────
await r.gotoAndSettle("/me", 1800);
await r.beat("b4");
{
  const total = durMs("b4", 14.3);
  const gpsCard = page.getByText("Clock in when you start").first().locator("xpath=ancestor::li[1]");
  await r.spotlight(gpsCard, { hold: total - 5200, shot: "b4-gps-card" });
  await r.slowScroll(0, 1200);
  await r.parkCursor();
  await sleep(1800);
}

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
