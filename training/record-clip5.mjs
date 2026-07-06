// Clip 5 — "Ask + the Field Guide" (~80s). Beats match
// narration/clip-5-ask-field-guide.md; manifest → videos/ask-field-guide-beats.json.
//
// Usage:  node record-clip5.mjs <hashed_token from auth admin generate_link>
//
// Storyboard:
//   b1  /me — the AskBar: spotlight, TYPE the question, submit
//       (asking IS allowed — read-only lane; ask_interactions rows are fine)
//   b2  wait for + spotlight the rendered answer (AskResult card under the bar)
//   b3  /how-to#doctrine — money ladder (open one step to show the expand),
//       then the principles grid
//   b4  the stuck ladder + the red app-access alert strip, park + close

import { createRecorder, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-clip5.mjs <hashed_token>"); process.exit(1); }

const QUESTION = "how do I charge for a hydrostatic test?";

const D = loadDurations("clip-5-ask-field-guide");
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "ask-field-guide", hashedToken, startPath: "/me" });
const { page } = r;

// Cursor-alive wait (same pattern as clip 4) — drift in the empty right margin.
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

const askInput = page.getByPlaceholder(/Ask anything/i).first();
// The AskBar wrapper div (form + result) — the answer renders as its child.
const askWrap = askInput.locator('xpath=ancestor::div[contains(@class,"mb-6")][1]');

// ── b1: Ask — spotlight the bar, type the question, submit ──────────────────
await r.beat("b1");
{
  const total = durMs("b1", 11.7);
  const t0 = Date.now();
  await sleep(600);
  await r.spotlight(askInput, { hold: 1800, pad: 10, pulses: 2, shot: "b1-askbar" });
  await r.clickWith(askInput);
  await page.keyboard.type(QUESTION, { delay: 42 }); // visible keystrokes
  await r.shot("b1-typed");
  await sleep(500);
  const askBtn = askWrap.getByRole("button", { name: /^Ask$/ }).first();
  await r.clickWith(askBtn); // read-only ask lane — allowed
  await sleep(Math.max(total - (Date.now() - t0), 400));
}

// ── b2: the answer — wait it in (latency is real), then spotlight it ────────
await r.beat("b2");
{
  const total = durMs("b2", 18.3);
  const t0 = Date.now();
  await r.shot("b2-thinking");
  // While pending, AskBar renders a bare "Thinking…" div.mt-2; the real answer
  // (AskResult card / error box) is a CHILD div inside div.mt-2 — wait for that.
  const answered = askWrap.locator("div.mt-2 > div").first();
  const ok = await waitAlive(answered, 120_000);
  if (!ok) {
    console.error("FAILED: AskBar never rendered an answer — see screenshots");
    await r.shot("b2-answer-FAILED");
    await r.finish();
    process.exit(1);
  }
  if (await askWrap.locator("div.mt-2 div.bg-red-50").first().isVisible().catch(() => false)) {
    console.error("FAILED: AskBar returned an error box — failed take");
    await r.shot("b2-answer-ERROR");
    await r.finish();
    process.exit(1);
  }
  await sleep(600);
  const result = askWrap.locator("div.mt-2").first();
  await r.spotlight(result, { hold: Math.max(total - (Date.now() - t0) - 1200, 4000), shot: "b2-answer" });
}

// ── b3: the Field Guide — money ladder (expand one step) + principles ────────
await r.gotoAndSettle("/how-to#doctrine", 1800);
await r.beat("b3");
{
  const total = durMs("b3", 18.7);
  const ladderBoard = page.getByText("Board 1 · The money ladder").first()
    .locator("xpath=ancestor-or-self::section[1]");
  const firstStep = ladderBoard.locator("details").nth(1); // step 1 of the ladder
  await r.spotlight(firstStep, { hold: Math.round(total * 0.2), shot: "b3-ladder-step" });
  await r.clickWith(firstStep.locator("summary").first()); // <details> expand — client-side
  await sleep(700);
  await r.spotlight(firstStep, { hold: Math.round(total * 0.22), pulses: 2, shot: "b3-step-open" });
  const principles = page.getByText("Board 2 · How we carry ourselves").first()
    .locator("xpath=ancestor-or-self::section[1]");
  await r.spotlight(principles, { hold: Math.round(total * 0.3), shot: "b3-principles" });
}

// ── b4: the stuck ladder + the red alert strip, then close ──────────────────
await r.beat("b4");
{
  const total = durMs("b4", 21.4);
  const stuck = page.getByText("Board 3 · When you're stuck").first()
    .locator("xpath=ancestor-or-self::section[1]");
  await r.spotlight(stuck, { hold: Math.round(total * 0.42), shot: "b4-stuck-ladder" });
  const alert = page.getByText(/App access broken/).first().locator("xpath=ancestor::div[1]");
  await r.spotlight(alert, { hold: Math.round(total * 0.3), pulses: 4, shot: "b4-alert-strip" });
  await r.parkCursor();
  await sleep(Math.max(Math.round(total * 0.12), 1500));
}

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
