// Clip 1 — "My Day: your home base" v5 (~90s, six beats). Rebuilt on
// lib/recorder.mjs: VISIBLE cursor gliding onto every named element while a
// gold spotlight ring pulses around it. Beats match narration/clip-1-my-day.md
// (v3, Danny's 7/07 notes — six beats); beat manifest → videos/my-day-beats.json.
//
// Usage:  node record-my-day.mjs <hashed_token from auth admin generate_link>
//   The token comes from the Supabase auth admin generate_link API (minted
//   server-side; one-time use, short-lived).
//
// Storyboard (all on /me, filmed as test-tech Al):
//   b1  the top — clock section
//   b2  daily expectations + team whiteboard (case-sensitive /Team whiteboard/
//       matcher — the v4 fix; the lowercase "team whiteboard" basics card is a
//       false match)
//   b3  quick-action tiles in sequence (Receipt, Voice note, Find a job, Ask),
//       closing on My coaching — narration names it, so it gets the emphasized
//       beat-closing spotlight
//   b4  📨 Message the office — spotlight collapsed row, CLICK to expand
//       (allowed), spotlight recipient chips + textarea. ⛔ NEVER click Send
//       (it fires REAL Slack DMs); nothing is typed (empty compose keeps Send
//       disabled — asserted). A click-shield is installed over the Send button
//       region as defense-in-depth; zero-send is re-asserted via UI + DB.
//   b5  the Daily Wrap card (never press Record)
//   b6  today's appointments — the two seeded training-demo rows spotlit,
//       slow scroll home, park, close
//
// Appointments are seeded TPAR-side only (appointments_master rows with
// appointment_id 'training-demo-%', zero HCP writes) right before the take and
// deleted right after — see the session runbook.

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
  const total = durMs("b1", 18.2);
  await sleep(1400); // let the opening line land on the untouched page
  const clockCard = page.locator("section", { has: page.getByRole("button", { name: /clock (in|out)/i }) }).first();
  await r.spotlight(clockCard, { hold: Math.round(total * 0.45), shot: "b1-clock" });
}
await paceTo("b1");

// ── b2: expectations + whiteboard ────────────────────────────────────────────
await beatStart("b2");
{
  const total = durMs("b2", 10.5);
  await r.spotlight(await r.sectionOf("Your day, the basics"), { hold: Math.round(total * 0.3), shot: "b2-expectations" });
  // Case-sensitive regex (v4 fix — do not regress): the "Read the team
  // whiteboard" basics card matches the lowercase substring — only the section
  // heading carries capital-T "Team".
  await r.spotlight(await r.sectionOf(/Team whiteboard/), { hold: Math.round(total * 0.3), shot: "b2-whiteboard" });
}
await paceTo("b2");

// ── b3: quick actions — four tiles, then the My-coaching close ───────────────
await beatStart("b3");
{
  const tiles = [
    ["/receipt", "b3-receipt"],
    ["/voice-notes/new", "b3-voice"],
    ["/find", "b3-find"],
    ["/ask", "b3-ask"],
  ];
  const total = durMs("b3", 19.6);
  const coachingHold = 3600; // beat-closing emphasis — narration names My coaching last
  const per = Math.max(Math.round(((total - coachingHold - 1400) * 0.85) / tiles.length) - 800, 1100);
  let first = true;
  for (const [href, shotName] of tiles) {
    await r.spotlight(page.locator(`a[href="${href}"]`).first(), {
      hold: per, pulses: 2, shot: shotName,
      settleMs: first ? 900 : 250, moveMs: first ? 900 : 550,
    });
    first = false;
  }
  // My coaching — its own beat-closing spotlight (3 pulses, longer rest).
  await r.spotlight(page.locator('a[href="/me/coaching"]').first(), {
    hold: coachingHold, pulses: 3, shot: "b3-coaching",
    settleMs: 300, moveMs: 600,
  });
}
await paceTo("b3");

// ── b4: 📨 Message the office — expand, chips, textarea. NEVER Send. ─────────
await beatStart("b4");
{
  const total = durMs("b4", 9.6);
  // Collapsed row spotlight.
  const collapsedRow = page.getByRole("button", { name: /Message the office/ }).first();
  await r.spotlight(collapsedRow, { hold: Math.round(total * 0.22), pulses: 2, shot: "b4-collapsed", settleMs: 500 });
  // Expand (the ONLY sanctioned click on this card).
  await r.clickWith(collapsedRow);
  const textarea = page.getByPlaceholder("What do they need to know?");
  await textarea.waitFor({ state: "visible", timeout: 6000 });
  await sleep(350);
  // Safety gate 1: Send must be disabled on the empty compose.
  const sendBtn = page.getByRole("button", { name: "Send", exact: true });
  const sendDisabled = await sendBtn.isDisabled().catch(() => null);
  console.log(`b4 check: Send disabled on empty compose = ${sendDisabled}`);
  // Safety gate 2: click-shield over the Send button region (capture-phase
  // event blocker + physical overlay). We never click it anyway — this is
  // defense-in-depth because Send now fires REAL Slack DMs.
  const shielded = await page.evaluate(() => {
    const send = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Send" || b.textContent.trim() === "📤 Sending…"
    );
    if (!send) return false;
    const block = (e) => {
      const t = e.target;
      if (t instanceof Element && (t === send || send.contains(t) || t.id === "__tpar_send_shield")) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "keydown"]) {
      document.addEventListener(type, block, true);
    }
    const rc = send.getBoundingClientRect();
    const sh = document.createElement("div");
    sh.id = "__tpar_send_shield";
    sh.style.cssText = `position:absolute;left:${rc.left + window.scrollX - 8}px;top:${rc.top + window.scrollY - 8}px;width:${rc.width + 16}px;height:${rc.height + 16}px;z-index:2147483646;background:transparent;`;
    document.body.appendChild(sh);
    return true;
  }).catch(() => false);
  console.log(`b4 check: send click-shield installed = ${shielded}`);
  // Recipient chips (ring around the chip row — parent of the office chip).
  const chipRow = page.getByRole("button", { name: /The office/ }).first().locator("xpath=..");
  await r.spotlight(chipRow, { hold: Math.round(total * 0.24), pulses: 2, shot: "b4-chips", settleMs: 300, moveMs: 550 });
  // Textarea — spotlight only. NOTHING is typed; Send stays disabled.
  await r.spotlight(textarea, { hold: Math.round(total * 0.24), pulses: 2, shot: "b4-textarea", settleMs: 250, moveMs: 550, cursorAt: { fx: 0.5, fy: 1.15 } });
  // Zero-send assertion (UI): no "Sent —" confirmation may exist anywhere.
  const sentVisible = await page.getByText(/Sent —/).count().catch(() => 0);
  console.log(`b4 check: zero sends (UI shows no "Sent —") = ${sentVisible === 0}`);
}
await paceTo("b4");

// ── b5: the Daily Wrap card (never press Record) ─────────────────────────────
await beatStart("b5");
await r.spotlight(await r.sectionOf("Daily wrap"), { hold: Math.round(durMs("b5", 19.0) * 0.5), shot: "b5-wrap" });
await paceTo("b5");

// ── b6: today's appointments — the two seeded rows + wrap-up ─────────────────
await beatStart("b6");
{
  const total = durMs("b6", 13.0);
  const apptSection = await r.sectionOf(/Today.s appointments/);
  await r.spotlight(apptSection, { hold: Math.round(total * 0.2), shot: "b6-appointments" });
  // The two seeded training-demo rows (9:00 AM assessment, 1:30 PM follow-up).
  const row1 = apptSection.locator("li", { hasText: "9:00 AM" }).first();
  const row2 = apptSection.locator("li", { hasText: "1:30 PM" }).first();
  await r.spotlight(row1, { hold: 1900, pulses: 2, shot: "b6-row1", settleMs: 300, moveMs: 550 });
  await r.spotlight(row2, { hold: 1900, pulses: 2, shot: "b6-row2", settleMs: 300, moveMs: 550 });
  await r.slowScroll(0, 2200);
  await r.parkCursor();
}
await paceTo("b6");

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
