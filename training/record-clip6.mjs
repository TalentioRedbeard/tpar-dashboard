// Clip 6 — "Receipts + photos" (~55s). Beats match
// narration/clip-6-receipts-photos.md; manifest → videos/receipts-beats.json.
//
// Usage:  node record-clip6.mjs <hashed_token from auth admin generate_link>
//
// Storyboard:
//   b1  /me — the Receipt tile → /receipt: the photo-capture area
//       (GUARDRAIL: NEVER submit the receipt form — spotlight only)
//   b2  the job picker + the detail fields (invoice/amount/vendor)
//   b3  back on /me — brief spotlight of the Daily wrap / tiles region,
//       park + close

import { createRecorder, createPacer, loadDurations, sleep } from "./lib/recorder.mjs";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-clip6.mjs <hashed_token>"); process.exit(1); }

const D = loadDurations("clip-6-receipts-photos"); // measured mp3 seconds per beat (v2c: speed 1.1/stab 0.4/sim 0.75)
const durMs = (b, fallbackSec) => Math.round(((D[b] ?? fallbackSec) + 0.7) * 1000);

const r = await createRecorder({ clip: "receipts", hashedToken, startPath: "/me" });
const { page } = r;

// Pace-to-narration (v2c anti-drag): shared floor logic from lib/recorder.mjs.
const { beatStart, paceTo } = createPacer(r, durMs);

// ── b1: the rule — Receipt tile, then the photo capture on /receipt ─────────
await beatStart("b1");
{
  const total = durMs("b1", 14.2);
  await sleep(600);
  const tile = page.locator('a[href="/receipt"]').first();
  await r.spotlight(tile, { hold: 2400, pulses: 3, shot: "b1-receipt-tile" });
  await r.clickWith(tile); // navigation — safe
  await sleep(1540);
  await r.syncCursor(); // new document → overlay re-created; re-sync
  const photoSection = page.getByText("Receipt photo *").first().locator("xpath=ancestor::section[1]");
  await r.spotlight(photoSection, { hold: Math.max(Math.round(total * 0.35), 3000), shot: "b1-photo-capture" });
}
await paceTo("b1");

// ── b2: what happens to it — the job picker + the fields ────────────────────
await beatStart("b2");
{
  const total = durMs("b2", 15.5);
  const jobPicker = page.getByText("Which job is this receipt for?").first()
    .locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  await r.spotlight(jobPicker, { hold: Math.round(total * 0.28), shot: "b2-job-picker" });
  const invoiceField = page.getByText("Invoice / job #", { exact: false }).first()
    .locator("xpath=ancestor::div[1]");
  await r.spotlight(invoiceField, { hold: Math.round(total * 0.2), pad: 10, shot: "b2-invoice-field" });
  const vendorField = page.getByText("Vendor (optional)").first().locator("xpath=ancestor::div[1]");
  await r.spotlight(vendorField, { hold: Math.round(total * 0.2), pad: 10, shot: "b2-vendor-field" });
  // NEVER touch the "Log receipt" submit button.
}

// ── b3: photos + close — home, the wrap/tiles region, park ───────────────────
// (nav rides inside b2's narration budget — paceTo runs after)
await r.gotoAndSettle("/me", 1260);
await paceTo("b2");
await beatStart("b3");
{
  const total = durMs("b3", 20.7);
  const tileGrid = page.locator('a[href="/receipt"]').first().locator("xpath=ancestor::div[1]");
  await r.spotlight(tileGrid, { hold: Math.round(total * 0.28), shot: "b3-tiles" });
  await r.spotlight(await r.sectionOf("Daily wrap"), { hold: Math.round(total * 0.28), pulses: 2, shot: "b3-wrap" });
  await r.slowScroll(0, 1500);
  await r.parkCursor();
}
await paceTo("b3");

await sleep(1500); // tail margin so the close never clips at video end
await r.finish();
