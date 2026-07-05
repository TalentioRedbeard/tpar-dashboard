// Clip 1 — "My Day: your home base" (~75s silent screen recording).
// Drives the DEPLOYED app as test-tech Al via a one-time magic link and records
// a guided tour of /me: slow scrolls, cursor glides, hover pauses — beats match
// narration/clip-1-my-day.md so the voice track drops straight on in assembly.
//
// Usage:  node record-my-day.mjs "<magic-link-action-url>"
//   The link comes from the Supabase auth admin generate_link API (minted
//   server-side; one-time use, short-lived). Output: videos/my-day-<date>.webm
import { chromium } from "playwright";

const hashedToken = process.argv[2];
if (!hashedToken) { console.error("usage: node record-my-day.mjs <hashed_token from auth admin generate_link>"); process.exit(1); }

const APP = "https://tpar-dashboard.vercel.app";
const SUPA = "https://bwpoqsfrygyopwxmegax.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3cG9xc2ZyeWd5b3B3eG1lZ2F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMzkyNTcsImV4cCI6MjA4MjM5OTI1N30.HMwTK2obYHnv96hOcB6XMSkPXJicWL4nhUS2c7wUb2Q"; // public anon key
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exchange the admin-minted token_hash for a full session (deterministic — no
// redirect allowlist involved), then hand Playwright the exact cookies
// @supabase/ssr (v0.10: "base64-" + base64url JSON, chunked at 3180) expects.
async function mintSessionCookies() {
  const r = await fetch(`${SUPA}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", token_hash: hashedToken }),
  });
  if (!r.ok) throw new Error(`verify failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const session = await r.json();
  if (!session.access_token || !session.refresh_token) throw new Error("verify returned no session tokens");
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = "sb-bwpoqsfrygyopwxmegax-auth-token";
  const CHUNK = 3180;
  const cookies = [];
  if (value.length <= CHUNK) {
    cookies.push({ name, value });
  } else {
    for (let i = 0; i * CHUNK < value.length; i++) {
      cookies.push({ name: `${name}.${i}`, value: value.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  }
  return cookies.map((c) => ({
    ...c, domain: "tpar-dashboard.vercel.app", path: "/",
    secure: true, httpOnly: false, sameSite: "Lax",
    expires: Math.floor(Date.now() / 1000) + 3600,
  }));
}

// Smooth cursor glide (Playwright moves in steps = visible travel on video).
async function glideTo(page, x, y, steps = 40) { await page.mouse.move(x, y, { steps }); }

async function slowScroll(page, toY, ms = 1800) {
  const fromY = await page.evaluate(() => window.scrollY);
  const frames = Math.max(1, Math.round(ms / 40));
  for (let i = 1; i <= frames; i++) {
    const y = fromY + ((toY - fromY) * i) / frames;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(40);
  }
}

async function hoverText(page, text, holdMs = 1600) {
  const el = page.getByText(text, { exact: false }).first();
  try {
    await el.waitFor({ state: "visible", timeout: 4000 });
    const box = await el.boundingBox();
    if (box) { await glideTo(page, box.x + box.width / 2, box.y + box.height / 2); }
    await sleep(holdMs);
  } catch { /* narration carries the beat even if the element moved */ }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "videos", size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

// ── Sign in: session cookies minted directly from the token exchange ─────────
await context.addCookies(await mintSessionCookies());
const page2 = page; // cookies apply context-wide
await page2.goto(`${APP}/me`, { waitUntil: "networkidle" }).catch(() => {});
await sleep(2500);

// HARD GATE: refuse to film the wrong page. /me redirects to /login when signed out.
const landed = page.url();
await page.screenshot({ path: "videos/frame-signin-check.png" });
if (landed.includes("/login") ) {
  console.error(`FAILED: not signed in — landed on ${landed}. See videos/frame-signin-check.png`);
  await context.close(); await browser.close();
  process.exit(1);
}
const shot = async (name) => page.screenshot({ path: `videos/frame-${name}.png` }).catch(() => {});

// ── Beat 1 (0:00-0:12): the top — clock button + today ──────────────────────
await glideTo(page, 640, 220);
await sleep(3500);
await hoverText(page, "Clock", 2500);
await shot("beat1");
await sleep(2000);

// ── Beat 2 (0:12-0:28): expectations + whiteboard ────────────────────────────
await slowScroll(page, 500);
await hoverText(page, "expectation", 2200);
await slowScroll(page, 850);
await hoverText(page, "Whiteboard", 2200);
await sleep(1500);

// ── Beat 3 (0:28-0:45): quick actions — receipt, voice note, find, ask ──────
await slowScroll(page, 1150);
await hoverText(page, "Receipt", 1800);
await hoverText(page, "Voice note", 1800);
await hoverText(page, "Find a job", 1800);
await hoverText(page, "Ask", 1800);

// ── Beat 4 (0:45-0:58): the Daily Wrap card ──────────────────────────────────
await hoverText(page, "Daily Wrap", 3000);
await shot("beat4");
await sleep(2000);

// ── Beat 5 (0:58-1:15): today's appointments + wrap-up ──────────────────────
await slowScroll(page, 1600);
await hoverText(page, "appointment", 2500);
await slowScroll(page, 0, 2500);
await sleep(3000);

const video = await page.video()?.path();
await context.close();
await browser.close();
console.log("recorded:", video);
