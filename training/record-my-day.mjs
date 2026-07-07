// Clip 1 — "My Day: your home base" (~80s). Rebuilt on lib/recorder.mjs so the
// tour has what Danny asked for: a VISIBLE cursor that glides onto every named
// element while a gold spotlight ring pulses around it. Beats match
// narration/clip-1-my-day.md; beat manifest → videos/my-day-beats.json.
//
// Usage:  node record-my-day.mjs <hashed_token from auth admin generate_link>
//   The token comes from the Supabase auth admin generate_link API (minted
//   server-side; one-time use, short-lived).
//
// Storyboard (all on /me):
//   b1  the top — clock section
//   b2  daily expectations + team whiteboard
//   b3  quick-action tiles, each in sequence (Receipt, Voice note, Find a job,
//       Ask, My coaching)
//   b4  the Daily wrap card
//   b5  today's appointments + slow scroll home

import { createRecorder, createPacer, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-my-day.mjs <hashed_token>"); process.exit(1); }

const D = loadDurations("clip-1-my-day"); // measured mp3 seconds per beat (v2c: speed 1.1/stab 0.4/sim 0.75)
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "my-day", hashedToken, startPath: "/me" });
const { page } = r;

// Pace-to-narration (v2c anti-drag): shared floor logic from lib/recorder.mjs.
const { beatStart, paceTo } = createPacer(r, durMs);

// ── b1: the top — the clock section ──────────────────────────────────────────
await beatStart("b1");
{
  const total = durMs("b1", 17);
  await sleep(1200); // let the opening line land on the untouched page
  const clockCard = page.locator("section", { has: page.getByRole("button", { name: /clock (in|out)/i }) }).first();
  await r.spotlight(clockCard, { hold: Math.round(total * 0.5), shot: "b1-clock" });
}
await paceTo("b1");

// ── b2: expectations + whiteboard ────────────────────────────────────────────
await beatStart("b2");
{
  const total = durMs("b2", 12.5);
  await r.spotlight(await r.sectionOf("Your day, the basics"), { hold: Math.round(total * 0.3), shot: "b2-expectations" });
  // Case-sensitive regex: the "Read the team whiteboard" basics card matches the
  // lowercase substring — only the section heading carries capital-T "Team".
  await r.spotlight(await r.sectionOf(/Team whiteboard/), { hold: Math.round(total * 0.3), shot: "b2-whiteboard" });
}
await paceTo("b2");

// ── b3: quick actions — every tile, in narration order ───────────────────────
await beatStart("b3");
{
  const tiles = [
    ["/receipt", "b3-receipt"],
    ["/voice-notes/new", "b3-voice"],
    ["/find", "b3-find"],
    ["/ask", "b3-ask"],
    ["/me/coaching", "b3-coaching"],
  ];
  const total = durMs("b3", 19);
  const per = Math.max(Math.round((total * 0.8) / tiles.length) - 900, 1100); // minus glide+settle overhead
  let first = true;
  for (const [href, shotName] of tiles) {
    await r.spotlight(page.locator(`a[href="${href}"]`).first(), {
      hold: per, pulses: 2, shot: shotName,
      settleMs: first ? 900 : 250, moveMs: first ? 900 : 550,
    });
    first = false;
  }
}
await paceTo("b3");

// ── b4: the Daily wrap card ───────────────────────────────────────────────────
await beatStart("b4");
await r.spotlight(await r.sectionOf("Daily wrap"), { hold: Math.round(durMs("b4", 18) * 0.55), shot: "b4-wrap" });
await paceTo("b4");

// ── b5: today's appointments + wrap-up ────────────────────────────────────────
await beatStart("b5");
{
  const total = durMs("b5", 13.5);
  await r.spotlight(await r.sectionOf(/Today.s appointments/), { hold: Math.round(total * 0.4), shot: "b5-appointments" });
  await r.slowScroll(0, 2200);
  await r.parkCursor();
}
await paceTo("b5");

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
