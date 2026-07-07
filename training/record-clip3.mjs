// Clip 3 — "Your Daily Wrap" (~50s). Beats match narration/clip-3-daily-wrap.md;
// manifest → videos/daily-wrap-beats.json.
//
// Usage:  node record-clip3.mjs <hashed_token from auth admin generate_link>
//
// Storyboard:
//   b1  /me — the Daily wrap card + its Record button
//       (GUARDRAIL: NEVER click Record — mic capture uploads. Spotlight only.)
//   b2  the card again — "where it goes" (narration carries the meaning)
//   b3  /settings — "How the app fits you" group → the Wrap reminder toggle,
//       then home to /me, park + close.

import { createRecorder, createPacer, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-clip3.mjs <hashed_token>"); process.exit(1); }

const D = loadDurations("clip-3-daily-wrap"); // measured mp3 seconds per beat (v2c: speed 1.1/stab 0.4/sim 0.75)
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "daily-wrap", hashedToken, startPath: "/me" });
const { page } = r;

// Pace-to-narration (v2c anti-drag): shared floor logic from lib/recorder.mjs.
const { beatStart, paceTo } = createPacer(r, durMs);

// The wrap card: DailyWrapCard renders <section> > div.rounded-2xl with the
// "Daily wrap" header + the 🎙️ Record button.
const wrapCard = await r.sectionOf("Daily wrap");

// ── b1: the card + the Record button (spotlight only) ────────────────────────
await beatStart("b1");
{
  const total = durMs("b1", 15.4);
  await sleep(800);
  await r.spotlight(wrapCard, { hold: Math.round(total * 0.42), shot: "b1-wrap-card" });
  // The card's own Record button (scoped INSIDE the card — never the floating
  // quick-Record). Spotlight only; no click.
  const recordBtn = wrapCard.getByRole("button", { name: /record/i }).first();
  await r.spotlight(recordBtn, { hold: Math.round(total * 0.26), pad: 10, pulses: 4, shot: "b1-record-btn" });
}
await paceTo("b1");

// ── b2: where it goes — hold on the card while the narration carries it ─────
await beatStart("b2");
{
  const total = durMs("b2", 17.4);
  const prompt = page.getByText(/How.d the day go, what fought you/).first();
  await r.spotlight(prompt, { hold: Math.round(total * 0.4), pad: 12, shot: "b2-prompt" });
  await r.spotlight(wrapCard, { hold: Math.round(total * 0.3), pulses: 2, shot: "b2-card" });
}

// ── b3: the reminder — /settings → wrap-reminder toggle → home ──────────────
// (nav rides inside b2's narration budget — paceTo runs after)
await r.gotoAndSettle("/settings", 1260);
await paceTo("b2");
await beatStart("b3");
{
  const total = durMs("b3", 11.3);
  const fitsGroup = page.getByText("How the app fits you").first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await r.spotlight(fitsGroup, { hold: Math.round(total * 0.24), shot: "b3-fits-group" });
  const wrapToggle = page.getByText("Wrap reminder", { exact: true }).first().locator("xpath=ancestor::label[1]");
  await r.spotlight(wrapToggle, { hold: Math.round(total * 0.3), pad: 10, pulses: 4, shot: "b3-wrap-toggle" });
  await r.gotoAndSettle("/me", 1500);
  await r.parkCursor();
  await r.shot("b3-home");
}
await paceTo("b3");

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
