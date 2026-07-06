// Clip 0 — "Welcome to the TPAR app" (~80-90s series opener).
// Beats match narration/clip-0-intro.md. Built on lib/recorder.mjs: rendered
// cursor, spotlight rings, beat manifest → videos/intro-beats.json.
//
// Usage:  node record-intro.mjs <hashed_token from auth admin generate_link>
//
// Storyboard:
//   b1  title card (the swappable HOST SLOT — keep it a distinct beat)
//   b2  /me — clock section → quick-action tiles → Daily wrap
//   b3  /find — the search input
//   b4  /estimate/new — "Price it with me" (opened live) + the options area
//   b5  the AskBar (persistent under-header ask bar, same page)
//   b6  /how-to — Field Guide money ladder, then home to /me

import { createRecorder, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-intro.mjs <hashed_token>"); process.exit(1); }

// A neutral test customer so the estimate builder renders fully for Al
// (no param → customer picker only; real customer names stay out of the clip).
const DEMO_CUSTOMER = "cus_d4dd79856773477cba547f20a940af86"; // "Marketing Test"

const D = loadDurations("clip-0-intro"); // measured mp3 seconds per beat (optional)
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "intro", hashedToken, startPath: "/me" });
const { page } = r;

// ── b1: title card — the host slot ──────────────────────────────────────────
await r.parkCursor();
await r.beat("b1");
await r.titleCard({
  title: "TULSA PLUMBING & REMODELING",
  subtitle: "The TPAR App — the one-minute map",
  hold: durMs("b1", 18.5),
});

// ── b2: /me — home base sweep (clock → tiles → Daily wrap) ──────────────────
await r.beat("b2");
{
  const total = durMs("b2", 14.5);
  const clockCard = page.locator("section", { has: page.getByRole("button", { name: /clock (in|out)/i }) }).first();
  await r.spotlight(clockCard, { hold: Math.round(total * 0.20), shot: "b2-clock" });
  const tileGrid = page.locator('a[href="/receipt"]').locator("xpath=ancestor::div[1]");
  await r.spotlight(tileGrid, { hold: Math.round(total * 0.20), shot: "b2-tiles" });
  await r.spotlight(await r.sectionOf("Daily wrap"), { hold: Math.round(total * 0.18), shot: "b2-wrap" });
}

// ── b3: /find — search by name, address, or memory ──────────────────────────
await r.gotoAndSettle("/find");
await r.beat("b3");
{
  const input = page.getByPlaceholder(/trotzuk|leave empty/i).first();
  await r.spotlight(input, { hold: durMs("b3", 10) - 3500, pad: 10, shot: "b3-search" });
}

// ── b4: /estimate/new — Price it with me + the options area ─────────────────
await r.gotoAndSettle(`/estimate/new?customer=${DEMO_CUSTOMER}`, 2200);
await r.beat("b4");
{
  const total = durMs("b4", 20);
  const priceCard = page.getByText("Price it with me").first().locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await r.spotlight(priceCard, { hold: Math.round(total * 0.16), shot: "b4-price" });
  // Open it live — shows the click ripple + the "describe the work" textarea.
  await r.clickWith(page.getByText("Price it with me").first());
  await sleep(700);
  const textarea = page.locator("textarea").first();
  await r.spotlight(textarea, { hold: Math.round(total * 0.22), pad: 10, shot: "b4-describe" });
  const optionCard = page.locator('input[placeholder*="Option 1 name"]').first().locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await r.spotlight(optionCard, { hold: Math.round(total * 0.28), shot: "b4-options" });
}

// ── b5: the AskBar — same page, glide up to the persistent ask bar ──────────
await r.beat("b5");
{
  const ask = page.getByPlaceholder(/Ask anything/i).first();
  await r.spotlight(ask, { hold: durMs("b5", 10) - 3200, pad: 10, shot: "b5-askbar" });
}

// ── b6: /how-to — the Field Guide (money ladder), then home ─────────────────
await r.gotoAndSettle("/how-to");
await r.beat("b6");
{
  const total = durMs("b6", 11.5);
  const board = page.getByText("Board 1 · The money ladder").first().locator("xpath=ancestor-or-self::section[1]");
  await r.spotlight(board, { hold: Math.round(total * 0.35), shot: "b6-ladder" });
  // Slow scroll down through the ladder steps.
  const y = await page.evaluate(() => window.scrollY);
  await r.slowScroll(y + 550, Math.round(total * 0.22));
  await r.gotoAndSettle("/me");
  await r.slowScroll(0, 600);
  await sleep(2500);
}

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
