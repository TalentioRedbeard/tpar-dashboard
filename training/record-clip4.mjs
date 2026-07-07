// Clip 4 — "Building an estimate + Price it with me" (~2:45-3:15, the deep dive).
// Beats match narration/clip-4-estimate-piwm.md; manifest → videos/estimate-piwm-beats.json.
//
// Usage:  node record-clip4.mjs <hashed_token from auth admin generate_link>
//
// REAL flow on camera (per storyboard): open Price it with me → TYPE the
// description (visible keystrokes) → Start → the ~25s extract wait STAYS IN
// (b3 narration covers it; cursor kept gently alive) → answer two judgment
// questions → Build my line items → ~50s wait stays in (b5) → proposed cards →
// click "+ Add to Option 1" for ONE line (client-side, allowed) → b6 spotlight
// the injected line in Option 1.
//
// GUARDRAILS: NEVER submit/push the estimate (no "Send", no create button —
// nothing below the options gets clicked). PIWM + add-to-option only.

import { createRecorder, createPacer, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-clip4.mjs <hashed_token>"); process.exit(1); }

// "Marketing Test" — the neutral demo customer the intro recorder uses.
const DEMO_CUSTOMER = "cus_d4dd79856773477cba547f20a940af86";

const DESCRIPTION =
  "Water coming through the kitchen ceiling under the upstairs bath. I want to hydrostatic test the tub drain and probably camera the line. 1960s cast iron, crawl-space access only.";
const ANSWERS = ["diagnostic only for now", "crawl space, tight but workable"];

const D = loadDurations("clip-4-estimate-piwm"); // measured mp3 seconds per beat (v2c: speed 1.1/stab 0.4/sim 0.75)
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({
  clip: "estimate-piwm",
  hashedToken,
  startPath: `/estimate/new?customer=${DEMO_CUSTOMER}`,
});
const { page } = r;

// Pace-to-narration (v2c anti-drag): shared floor logic from lib/recorder.mjs.
// EXCEPTION — the extract (b3) and build (b5) waits are REAL and event-driven;
// the narration was written to ride them. paceTo on those beats is a floor
// only (no-op when the wait overran the mp3) — the waits are never truncated.
const { beatStart, paceTo } = createPacer(r, durMs);

// Wait for a locator while keeping the rendered cursor gently alive (slow
// drift between two empty-margin anchor points). Returns true when visible.
async function waitAlive(locator, timeoutMs, anchors = [[900, 430], [860, 470]]) {
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

// ── b1: the builder — options + the 4-question cascade ──────────────────────
await sleep(1000); // pricebook loads client-side
await beatStart("b1");
{
  const total = durMs("b1", 23.5);
  const optionCard = page.locator('input[placeholder*="Option 1 name"]').first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await r.spotlight(optionCard, { hold: Math.round(total * 0.34), shot: "b1-option-card" });
  const lineRow = optionCard.locator("div.mb-2.rounded-md").first();
  await r.spotlight(lineRow, { hold: Math.round(total * 0.36), shot: "b1-cascade" });
}
await paceTo("b1");

// ── b2: describe the work — open PIWM + type it ──────────────────────────────
await beatStart("b2");
const piwmPanel = () => page.getByText("Price it with me").first()
  .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
{
  const header = page.getByText("Price it with me").first();
  await r.spotlight(header, { hold: 1800, pulses: 2, shot: "b2-piwm-header" });
  await r.clickWith(header); // opens the panel (client-side)
  await sleep(800);
  const textarea = piwmPanel().locator("textarea").first();
  await r.spotlight(textarea, { hold: 1400, pad: 10, pulses: 2 });
  await r.clickWith(textarea);
  await page.keyboard.type(DESCRIPTION, { delay: 38 }); // ~7s of visible typing
  await r.shot("b2-describe");
}
await paceTo("b2"); // floor: let the mp3 finish before Start fires

// ── b3: Start → the extract wait stays IN (narration teaches the ladder) ────
{
  const startBtn = piwmPanel().getByRole("button", { name: /^Start/ }).first();
  await r.clickWith(startBtn);
  await beatStart("b3"); // mp3 lands the moment the wait begins
  await r.shot("b3-extract-wait");
  const scoped = await waitAlive(page.getByRole("button", { name: /Build my line items/ }), 150_000);
  if (!scoped) {
    console.error("FAILED: extract never returned (no 'Build my line items' button) — see screenshots");
    await r.shot("b3-extract-FAILED");
    await r.finish();
    process.exit(1);
  }
  // If narration still has runway, let it breathe on the scoped view.
  await r.shot("b3-scoped");
}
await paceTo("b3"); // floor only — no-op when the real extract wait overran

// ── b4: the judgment questions — answer two, in the inputs ──────────────────
await beatStart("b4");
{
  const total = durMs("b4", 14.3);
  const qHeader = page.getByText("Your judgment calls").first();
  const hasQuestions = await qHeader.isVisible().catch(() => false);
  if (hasQuestions) {
    const qBlock = qHeader.locator("xpath=ancestor::div[1]");
    await r.spotlight(qBlock, { hold: Math.round(total * 0.3), shot: "b4-questions" });
    const inputs = qBlock.locator("input");
    const n = Math.min(await inputs.count().catch(() => 0), ANSWERS.length);
    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      await input.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })).catch(() => {});
      await sleep(500);
      await r.clickWith(input);
      await page.keyboard.type(ANSWERS[i], { delay: 40 });
      await sleep(400);
    }
    await r.shot("b4-answered");
  } else {
    // No questions came back — spotlight the scope chips; narration carries it.
    await r.spotlight(page.getByText("Scope I heard").first(), { hold: Math.round(total * 0.5), shot: "b4-scope-chips" });
  }
}
await paceTo("b4"); // floor: let the mp3 finish before Build fires

// ── b5: Build my line items → the pricing wait stays IN ─────────────────────
{
  const buildBtn = page.getByRole("button", { name: /Build my line items/ }).first();
  await buildBtn.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })).catch(() => {});
  await sleep(600);
  await r.clickWith(buildBtn);
  await beatStart("b5");
  await r.shot("b5-building");
  const proposed = await waitAlive(page.getByText("Add into:").first(), 240_000);
  if (!proposed) {
    console.error("FAILED: propose never returned (no 'Add into:' select) — see screenshots");
    await r.shot("b5-propose-FAILED");
    await r.finish();
    process.exit(1);
  }
}
await paceTo("b5"); // floor only — no-op when the real build wait overran

// ── b6: the lines land — add ONE to Option 1, spotlight the injected line ───
await beatStart("b6");
{
  const total = durMs("b6", 19.3);
  const firstCard = piwmPanel().locator("div.rounded-lg.bg-neutral-50").first();
  await r.spotlight(firstCard, { hold: Math.round(total * 0.26), shot: "b6-proposed" });
  const addBtn = firstCard.getByRole("button", { name: /\+ Add to/ }).first();
  await r.clickWith(addBtn); // client-side injection — allowed
  await sleep(900);
  await r.shot("b6-added-notice");
  const optionCard = page.locator('input[placeholder*="Option 1 name"]').first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const injected = optionCard.locator("div.mb-2.rounded-md").first();
  await r.spotlight(injected, { hold: Math.round(total * 0.3), pulses: 4, shot: "b6-injected-line" });
  await r.parkCursor();
}
await paceTo("b6");

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
