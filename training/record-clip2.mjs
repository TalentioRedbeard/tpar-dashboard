// Clip 2 — "Clocking in + your status buttons" (~70s). Beats match
// narration/clip-2-clock-status.md; manifest → videos/clock-status-beats.json.
//
// Usage:  node record-clip2.mjs <hashed_token from auth admin generate_link>
//
// v2 (2026-07-06, per Danny): b2 now films the REAL job-page trigger bar.
// Test-tech Al is temporarily seeded onto Danny's HCP test job (appended to
// appointments_master.tech_all_names for the job below — seeded + cleaned up
// OUTSIDE this script; the /job/[id] tech gate passes via job_360.tech_all_names).
//   b1  /me — the clock section (SPOTLIGHT ONLY — never press Clock in/out)
//   b2  /job/<TEST_JOB> — the "Lifecycle triggers" button bar, ringed.
//       ⚠ EXTREME CAUTION: these are ONE-TAP LIVE buttons (HCP + Slack).
//       A capture-phase click shield is injected on this page, the cursor's
//       glide target is parked BELOW the bar (cursorAt fy>1 — never a button
//       center), and the script hard-fails if the scope gate blocks Al.
//   b3  /me — "Your day, the basics" → the "Press your status buttons" card
//       (names the four: On My Way → Start → Finish → Collect)
//   b4  /me — the "Clock in when you start" basics card (the GPS assist),
//       park + close
//
// GUARDRAIL: no clicks anywhere in this clip — spotlight only. ZERO mousedown
// on the job page (shield asserts it).

import { createRecorder, createPacer, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-clip2.mjs <hashed_token>"); process.exit(1); }

// Danny's dormant HCP test job (customer cus_9cf8cc5b02e1430a85288b034763cc19,
// job date 2026-04-20, HCP status "scheduled" — nothing live moves it).
const TEST_JOB_ID = "job_49e3db09443b4fd1a1977c1d4296a35f";

const D = loadDurations("clip-2-clock-status"); // measured mp3 seconds per beat (v2c: speed 1.1/stab 0.4/sim 0.75)
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "clock-status", hashedToken, startPath: "/me" });
const { page } = r;

// Pace-to-narration (v2c anti-drag): shared floor logic from lib/recorder.mjs.
const { beatStart, paceTo } = createPacer(r, durMs);

// ── b1: the clock, on My Day ─────────────────────────────────────────────────
await beatStart("b1");
{
  const total = durMs("b1", 14.5);
  await sleep(1200); // let the opening line land on the untouched page
  const clockCard = page.locator("section", { has: page.getByRole("button", { name: /clock (in|out)/i }) }).first();
  await r.spotlight(clockCard, { hold: Math.round(total * 0.55), shot: "b1-clock" });
}

// ── b2: the REAL status buttons — the job page's lifecycle trigger bar ──────
// (nav + shield + gate ride inside b1's narration budget — paceTo runs after)
await r.gotoAndSettle(`/job/${TEST_JOB_ID}`, 1540);

// SAFETY SHIELD (job page only): swallow any press-shaped event at the window
// capture phase before it can reach a live trigger button, and count attempts
// so we can ASSERT zero at the end of the beat. Spotlight never presses — this
// is belt + suspenders on a page where a single tap fires into HCP + Slack.
await page.evaluate(() => {
  window.__pressAttempts = 0;
  for (const t of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "dblclick", "contextmenu"]) {
    window.addEventListener(t, (e) => { window.__pressAttempts++; e.preventDefault(); e.stopImmediatePropagation(); }, true);
  }
}).catch(() => {});

// HARD GATE: if the tech-scope wall (or a not-found page) rendered, refuse to film.
{
  const wallTexts = ["Outside your scope", "You weren't on this job", "Job not found", "Couldn't find that job"];
  for (const t of wallTexts) {
    if ((await page.getByText(t).count().catch(() => 0)) > 0) {
      await r.shot("b2-FAIL-scope-gate");
      console.error(`FAILED: job page blocked ("${t}") — the Al seed didn't hold. See videos/frame-clock-status-b2-FAIL-scope-gate.png`);
      await r.finish();
      process.exit(1);
    }
  }
  // And positively require the trigger bar before rolling the beat.
  try {
    await page.getByRole("heading", { name: "Lifecycle triggers" }).waitFor({ state: "visible", timeout: 8000 });
  } catch {
    await r.shot("b2-FAIL-no-trigger-bar");
    console.error("FAILED: 'Lifecycle triggers' section not found on the job page. See videos/frame-clock-status-b2-FAIL-no-trigger-bar.png");
    await r.finish();
    process.exit(1);
  }
}

await paceTo("b1");
await beatStart("b2");
{
  const total = durMs("b2", 16.8);
  // Ring the BUTTON BAR itself (the 7-button grid), but rest the cursor just
  // BELOW the bar (fy 1.25 → outside the box): near the buttons, on none of them.
  const triggerSection = page.locator("section", { has: page.getByRole("heading", { name: "Lifecycle triggers" }) }).first();
  const bar = triggerSection.locator("div.grid", { has: page.getByRole("button", { name: "On My Way" }) }).first();
  await r.spotlight(bar, { hold: Math.round(total * 0.72), pulses: 5, pad: 10, shot: "b2-trigger-bar", cursorAt: { fx: 0.5, fy: 1.25 } });
  const attempts = await page.evaluate(() => window.__pressAttempts ?? -1).catch(() => -1);
  if (attempts !== 0) {
    console.error(`FAILED SAFETY ASSERT: ${attempts} press-shaped event(s) reached the job page (all were shielded, but this run is void).`);
    await r.finish();
    process.exit(1);
  }
  console.log("job-page press events: 0 (asserted)");
}

// ── b3: the basics card that names all four, back on /me ────────────────────
await r.gotoAndSettle("/me", 1260);
await paceTo("b2");
await beatStart("b3");
{
  const total = durMs("b3", 14.7);
  const statusCard = page.getByText("Press your status buttons").first().locator("xpath=ancestor::li[1]");
  await r.spotlight(statusCard, { hold: Math.round(total * 0.65), pulses: 4, shot: "b3-status-card" });
}
await paceTo("b3");

// ── b4: the GPS assist + close — the clock-in basics card on /me ────────────
await beatStart("b4");
{
  const total = durMs("b4", 14.3);
  const gpsCard = page.getByText("Clock in when you start").first().locator("xpath=ancestor::li[1]");
  await r.spotlight(gpsCard, { hold: Math.round(total * 0.45), shot: "b4-gps-card" });
  await r.slowScroll(0, 1200);
  await r.parkCursor();
}
await paceTo("b4");

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
