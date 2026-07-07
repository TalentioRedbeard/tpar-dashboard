// Clip 0 v2 — "Welcome to the TPAR app" (~4min series opener, the map).
// Beats match narration/clip-0-intro.md (Danny's edited 10-beat script, 7/06).
// Built on lib/recorder.mjs: rendered cursor, spotlight rings, beat manifest
// → videos/intro-beats.json.
//
// Usage:  node record-intro.mjs <hashed_token from auth admin generate_link>
//
// Storyboard (filmed as test-tech Al — every page renders his tech-scoped view):
//   b1  title card (the swappable HOST SLOT — keep it a distinct beat)
//   b2  /me — fast pass: clock → quick-action tiles → Daily wrap (clip 1 goes deep)
//   b3  /jobs ("My jobs", Al seeded onto the test job so the list is non-empty)
//       → /find (the dynamic search) — Danny's beat header is "Jobs / Find"
//   b4  /estimates ("My estimates" list) → /estimate/new?customer=<Marketing Test>
//       — spotlight "Price it with me", open it (allowed), textarea + Option 1
//   b5  /comms — Al's scoped view (empty-state card is the honest render)
//   b6  /gallery — the chooser (photo search); no grid without picking a job
//   b7  /shopping — Suppliers + Log-a-need (catalog/market links are
//       leadership-gated, so Al never sees them — see the deviation note)
//   b8  /settings — the "How the app fits you" group
//   b9  /me — AskBar: TYPE "where do receipts go?", submit, wait the answer in,
//       spotlight the "Not settled? Push it to Danny." footer, CLICK THE REVEAL
//       ONLY, spotlight the two urgency tiles.
//       ⛔ ABSOLUTE: NEVER click either tile (⏳ Can wait / 🚨 Need him now) —
//       they place real phone calls. A capture-phase click shield is installed
//       the moment the tiles appear + zero-press asserted after the beat.
//   b10 /how-to#doctrine — money ladder → stuck ladder, slow scroll, park, close
//   NOTE: Reports is never visited or spotlighted (removed from the script;
//   leadership-gated for Al anyway).

import { createRecorder, createPacer, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-intro.mjs <hashed_token>"); process.exit(1); }

// A neutral test customer so the estimate builder renders fully for Al
// (no param → customer picker only; real customer names stay out of the clip).
const DEMO_CUSTOMER = "cus_d4dd79856773477cba547f20a940af86"; // "Marketing Test"

const ASK_QUESTION = "where do receipts go?";

const D = loadDurations("clip-0-intro"); // measured mp3 seconds per beat (v2c: speed 1.1/stab 0.4/sim 0.75)
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "intro", hashedToken, startPath: "/me" });
const { page } = r;

// Pace-to-narration (v2c anti-drag): shared implementation in lib/recorder.mjs
// (v2's 258s video over 203s narration = the "feels slow" this fixes).
const { beatStart, paceTo } = createPacer(r, durMs);

// Cursor-alive wait (proven in clips 4/5) — drift in the empty right margin
// so the frame never looks frozen while a real latency runs.
async function waitAlive(locator, timeoutMs, anchors = [[980, 300], [940, 340]]) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < timeoutMs) {
    if (await locator.isVisible().catch(() => false)) return true;
    const [x, y] = anchors[i % anchors.length];
    i += 1;
    await r.glideTo(x, y, 1400);
    await sleep(900);
  }
  return false;
}

// ── b1: title card — the host slot ──────────────────────────────────────────
await r.parkCursor();
await beatStart("b1");
await r.titleCard({
  title: "TULSA PLUMBING & REMODELING",
  subtitle: "The TPAR App — the map",
  hold: durMs("b1", 22.8) - 900, // fade-out (~0.9s) rides inside the budget
});
await paceTo("b1");

// ── b2: /me — fast home-base pass (clock → tiles → Daily wrap) ──────────────
await beatStart("b2");
{
  const total = durMs("b2", 19.6);
  const clockCard = page.locator("section", { has: page.getByRole("button", { name: /clock (in|out)/i }) }).first();
  await r.spotlight(clockCard, { hold: Math.round(total * 0.16), shot: "b2-clock" });
  const tileGrid = page.locator('a[href="/receipt"]').locator("xpath=ancestor::div[1]");
  await r.spotlight(tileGrid, { hold: Math.round(total * 0.14), shot: "b2-tiles" });
  await r.spotlight(await r.sectionOf("Daily wrap"), { hold: Math.round(total * 0.12), shot: "b2-wrap" });
  await r.slowScroll(0, Math.round(total * 0.08));
}

// ── b3: /jobs (the nav "Jobs" route) → /find — Danny's "Jobs / Find" beat ────
await r.gotoAndSettle("/jobs", 1260);
await paceTo("b2");
await beatStart("b3");
{
  const total = durMs("b3", 25.4);
  // Al's tech-scoped "My jobs" list (seeded with the test job so a real row shows).
  const jobsList = page.locator("main ul.space-y-2").first();
  const listOk = await jobsList.isVisible().catch(() => false);
  if (listOk) {
    await r.spotlight(jobsList, { hold: Math.round(total * 0.24), shot: "b3-jobs-list" });
  } else {
    // Honest fallback: the scoped empty-state card still carries the beat.
    await r.spotlight(page.getByText(/No jobs assigned to you/i).first(), { hold: Math.round(total * 0.24), shot: "b3-jobs-empty" });
  }
  // "Search by name, by address — or just describe what you remember" = /find.
  await r.gotoAndSettle("/find", 1120);
  const input = page.getByPlaceholder(/trotzuk|leave empty/i).first();
  await r.spotlight(input, { hold: Math.round(total * 0.32), pad: 10, shot: "b3-search" });
}

// ── b4: /estimates → /estimate/new — Price it with me ───────────────────────
await r.gotoAndSettle("/estimates", 1260);
await paceTo("b3");
await beatStart("b4");
{
  const total = durMs("b4", 28.2);
  // Al's "My estimates" list (estimates on his scheduled customers).
  const estList = page.locator("main ul.space-y-2").first();
  if (await estList.isVisible().catch(() => false)) {
    await r.spotlight(estList, { hold: Math.round(total * 0.09), shot: "b4-pipeline" });
  } else {
    await r.spotlight(page.getByText(/No estimates yet on your scheduled customers/i).first(), { hold: Math.round(total * 0.09), shot: "b4-pipeline" });
  }
  await r.gotoAndSettle(`/estimate/new?customer=${DEMO_CUSTOMER}`, 1540);
  const priceCard = page.getByText("Price it with me").first().locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await r.spotlight(priceCard, { hold: Math.round(total * 0.07), shot: "b4-price" });
  // Open it live (allowed) — the click ripple + the "describe the work" textarea.
  await r.clickWith(page.getByText("Price it with me").first());
  await sleep(700);
  const textarea = page.locator("textarea").first();
  await r.spotlight(textarea, { hold: Math.round(total * 0.1), pad: 10, shot: "b4-describe" });
  const optionCard = page.locator('input[placeholder*="Option 1 name"]').first().locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await r.spotlight(optionCard, { hold: Math.round(total * 0.1), shot: "b4-options" });
}

// ── b5: /comms — the thread of record, scoped to Al ─────────────────────────
await r.gotoAndSettle("/comms", 1260);
await paceTo("b4");
await beatStart("b5");
{
  const total = durMs("b5", 14.7);
  // Al's scoped view: comm list if any, else the honest scoped empty-state card.
  const commList = page.locator("main ul.space-y-2").first();
  if (await commList.isVisible().catch(() => false)) {
    await r.spotlight(commList, { hold: total - 6200, shot: "b5-threads" });
  } else {
    const emptyCard = page.getByText(/No calls or texts|No customers on your schedule/i).first();
    await r.spotlight(emptyCard, { hold: total - 6200, shot: "b5-threads" });
  }
}

// ── b6: /gallery — every job photo, searchable ──────────────────────────────
await r.gotoAndSettle("/gallery", 1260);
await paceTo("b5");
await beatStart("b6");
{
  const total = durMs("b6", 10.9);
  // The chooser (tech view: "Your jobs" search input) — ring the input itself,
  // same proven pattern as the /find search. (No "rounded" ancestor exists —
  // the take-1 xpath resolved to nothing.)
  const jobsInput = page.getByPlaceholder(/Job # \/ invoice/i).first();
  if (await jobsInput.isVisible().catch(() => false)) {
    await r.spotlight(jobsInput, { hold: total - 5600, pad: 12, shot: "b6-search" });
  } else {
    await r.spotlight(page.getByText(/Find a job or customer/i).first(), { hold: total - 5600, shot: "b6-search" });
  }
}

// ── b7: /shopping — parts + pricing hub (Al's view) ─────────────────────────
await r.gotoAndSettle("/shopping", 1400);
await paceTo("b6");
await beatStart("b7");
{
  const total = durMs("b7", 14.5);
  // Catalog/market tiles are leadership-gated — try them first (in case the
  // gate changes), else spotlight what a tech actually gets: Suppliers + needs.
  const marketLink = page.getByText("Browse the parts catalog").first();
  if (await marketLink.isVisible().catch(() => false)) {
    await r.spotlight(await r.sectionOf("Market — prices, catalog & delivery"), { hold: total - 5000, shot: "b7-market" });
  } else {
    // The Suppliers SECTION is taller than the viewport (ring lands off-screen)
    // — ring its compact header instead, then the Log-a-need card.
    const suppliersHeader = page.getByRole("heading", { name: "Suppliers", exact: true }).first()
      .locator("xpath=ancestor::header[1]");
    await r.spotlight(suppliersHeader, { hold: Math.round(total * 0.3), pad: 10, shot: "b7-suppliers" });
    await r.spotlight(await r.sectionOf("Log a new need"), { hold: Math.round(total * 0.2), shot: "b7-log-need" });
  }
}

// ── b8: /settings — "How the app fits you" ──────────────────────────────────
await r.gotoAndSettle("/settings", 1260);
await paceTo("b7");
await beatStart("b8");
{
  const total = durMs("b8", 9.7);
  const fitsGroup = page.getByText("How the app fits you", { exact: true }).first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await r.spotlight(fitsGroup, { hold: total - 5200, shot: "b8-fits-you" });
}

// ── b9: /me — Ask + "Push it to Danny" (REVEAL ONLY — never the tiles) ──────
await r.gotoAndSettle("/me", 1400);
await paceTo("b8");
await beatStart("b9");
{
  const total = durMs("b9", 27.9);
  const t0 = Date.now();
  const askInput = page.getByPlaceholder(/Ask anything/i).first();
  const askWrap = askInput.locator('xpath=ancestor::div[contains(@class,"mb-6")][1]');

  await r.spotlight(askInput, { hold: 1000, pad: 10, pulses: 2, shot: "b9-askbar" });
  await r.clickWith(askInput);
  await page.keyboard.type(ASK_QUESTION, { delay: 42 }); // visible keystrokes
  await r.shot("b9-typed");
  await sleep(400);
  const askBtn = askWrap.getByRole("button", { name: /^Ask$/ }).first();
  await r.clickWith(askBtn); // read-only ask lane — allowed

  // Wait the real answer in (pending renders a bare "Thinking…" div.mt-2;
  // the real AskResult card is a CHILD div inside div.mt-2).
  const answered = askWrap.locator("div.mt-2 > div").first();
  const ok = await waitAlive(answered, 120_000);
  if (!ok) {
    console.error("FAILED: AskBar never rendered an answer — see screenshots");
    await r.shot("b9-answer-FAILED");
    await r.finish();
    process.exit(1);
  }
  if (await askWrap.locator("div.mt-2 div.bg-red-50").first().isVisible().catch(() => false)) {
    console.error("FAILED: AskBar returned an error box — failed take");
    await r.shot("b9-answer-ERROR");
    await r.finish();
    process.exit(1);
  }
  await sleep(500);
  await r.shot("b9-answer");

  // HARD GATE: the Push-to-Danny footer must have rendered (deployed 982e29e).
  const revealBtn = askWrap.getByRole("button", { name: /Not settled\? Push it to Danny\./ }).first();
  try {
    await revealBtn.waitFor({ state: "visible", timeout: 8000 });
  } catch {
    console.error("FAILED: 'Not settled? Push it to Danny.' footer never rendered under the answer — is 982e29e deployed? See videos/frame-intro-b9-FAIL-no-push-footer.png");
    await r.shot("b9-FAIL-no-push-footer");
    await r.finish();
    process.exit(1);
  }
  await r.spotlight(revealBtn, { hold: 1900, pad: 8, pulses: 2, shot: "b9-push-footer" });

  // CLICK THE REVEAL ONLY — client-side state flip, no send. The tiles it
  // reveals place REAL PHONE CALLS; they are never clicked (shield + assert).
  await r.clickWith(revealBtn);
  await sleep(700);
  const canWait = askWrap.getByRole("button", { name: /Can wait/ }).first();
  const needNow = askWrap.getByRole("button", { name: /Need him now/ }).first();
  const tilesUp = (await canWait.isVisible().catch(() => false)) && (await needNow.isVisible().catch(() => false));
  if (!tilesUp) {
    console.error("FAILED: urgency tiles did not appear after the reveal click");
    await r.shot("b9-FAIL-no-tiles");
    await r.finish();
    process.exit(1);
  }
  // SAFETY SHIELD from this moment on: swallow + count any press-shaped event
  // before it can reach a live tile. Spotlight never presses — belt + suspenders.
  await page.evaluate(() => {
    window.__pressAttempts = 0;
    for (const t of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "dblclick", "contextmenu"]) {
      window.addEventListener(t, (e) => { window.__pressAttempts++; e.preventDefault(); e.stopImmediatePropagation(); }, true);
    }
  });
  // Ring the tiles' CONTAINER, cursor parked BELOW the grid (fy>1 — never on a
  // tile). NOTE: the has: locator must be page-rooted (clip-2 pattern) — a
  // locator already rooted at askWrap silently matches nothing.
  const tileGrid = askWrap.locator("div.grid", { has: page.getByRole("button", { name: /Can wait/ }) }).first();
  const remaining = total - (Date.now() - t0);
  await r.spotlight(tileGrid, {
    hold: Math.max(remaining - 1600, 3200),
    pulses: 4, pad: 10, shot: "b9-urgency-tiles",
    cursorAt: { fx: 0.5, fy: 1.18 },
  });
  const attempts = await page.evaluate(() => window.__pressAttempts ?? -1).catch(() => -1);
  if (attempts !== 0) {
    console.error(`FAILED SAFETY ASSERT: ${attempts} press-shaped event(s) fired after the tiles appeared (all shielded, but this take is void).`);
    await r.finish();
    process.exit(1);
  }
  console.log("urgency-tile press events: 0 (asserted)");
  await r.parkCursor(); // move away from the tiles before the beat ends
}

// ── b10: /how-to#doctrine — the Field Guide, then close ─────────────────────
await r.gotoAndSettle("/how-to#doctrine", 1260);
await paceTo("b9"); // no-op when the live Ask wait already overran the budget
await beatStart("b10");
{
  const total = durMs("b10", 19.6);
  const ladderBoard = page.getByText("Board 1 · The money ladder").first()
    .locator("xpath=ancestor-or-self::section[1]");
  await r.spotlight(ladderBoard, { hold: Math.round(total * 0.3), shot: "b10-ladder" });
  const stuck = page.getByText("Board 3 · When you're stuck").first()
    .locator("xpath=ancestor-or-self::section[1]");
  await r.spotlight(stuck, { hold: Math.round(total * 0.22), shot: "b10-stuck" });
  // Slow scroll on through the guide, then park for the close.
  const y = await page.evaluate(() => window.scrollY);
  await r.slowScroll(y + 500, Math.round(total * 0.16));
  await r.parkCursor();
  await paceTo("b10"); // hold the close until the narration lands
}

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
