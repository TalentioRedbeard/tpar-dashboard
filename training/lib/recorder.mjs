// training/lib/recorder.mjs — shared recording library for TPAR training clips.
//
// Extracted from record-my-day.mjs (session mint via token exchange → cookies;
// hard signed-in gate; per-beat screenshots) and extended with the piece Danny
// asked for: a VISIBLE cursor. Playwright's video never captures the OS cursor,
// so we render one — an in-page SVG arrow overlay that follows the real
// mousemove events page.mouse.move() fires. On top of that:
//   • click ripple (expanding gold circle on mousedown)
//   • spotlight(target) — scrolls the element into view, glides the cursor
//     onto it (eased, multi-step), and pulses a rounded gold highlight ring
//     around its bounding box while the cursor rests there
//   • beat manifest — beat(name) records {name, t_ms since recording start};
//     finish() writes videos/<clip>-beats.json + renames the webm to the clip
//     name, so assembly can drop each narration mp3 at its beat time.
//
// The overlay is injected via context.addInitScript, so every new document
// (full navigation) re-creates it; gotoAndSettle() re-syncs the cursor to its
// last known position after each navigation.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

export const APP = "https://tpar-dashboard.vercel.app";
const SUPA = "https://bwpoqsfrygyopwxmegax.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3cG9xc2ZyeWd5b3B3eG1lZ2F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMzkyNTcsImV4cCI6MjA4MjM5OTI1N30.HMwTK2obYHnv96hOcB6XMSkPXJicWL4nhUS2c7wUb2Q"; // public anon key

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Session mint (exact working pattern from record-my-day.mjs) ─────────────
// Exchange the admin-minted token_hash for a full session (deterministic — no
// redirect allowlist involved), then hand Playwright the exact cookies
// @supabase/ssr (v0.10: "base64-" + base64url JSON, chunked at 3180) expects.
async function mintSessionCookies(hashedToken) {
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

// ── Rendered cursor overlay (init script — runs in every new document) ──────
// Fixed-position, pointer-events:none, max z-index. Follows real mousemove
// (which page.mouse.move fires), so it IS the mouse as far as video goes.
// Hotspot: the arrow tip sits at path point (3,2) of the 28px SVG.
const CURSOR_INIT = `(() => {
  if (window.__tparCursor) return;
  const state = { x: 640, y: 400, el: null };
  window.__tparCursor = state;
  const SVG = '<svg width="28" height="28" viewBox="0 0 28 28" style="display:block;filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.45))"><path d="M3 2 L3 22.5 L8.6 17.6 L12 25 L15.6 23.3 L12.3 16.1 L19.5 15.6 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function ensure() {
    let el = state.el;
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.id = '__tpar_cursor';
    el.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;margin:0;padding:0;pointer-events:none;z-index:2147483647;will-change:transform;';
    el.innerHTML = SVG;
    el.style.transform = 'translate(' + (state.x - 3) + 'px,' + (state.y - 2) + 'px)';
    (document.body || document.documentElement).appendChild(el);
    state.el = el;
    return el;
  }
  function moveTo(x, y) {
    state.x = x; state.y = y;
    ensure().style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)';
  }
  window.__tparCursorTo = moveTo;
  document.addEventListener('mousemove', (e) => moveTo(e.clientX, e.clientY), true);
  // Click ripple — expanding gold circle from the click point.
  document.addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:9999px;border:2.5px solid rgba(212,160,23,.95);background:rgba(212,160,23,.25);pointer-events:none;z-index:2147483646;';
    (document.body || document.documentElement).appendChild(r);
    const a = r.animate(
      [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(3.4)', opacity: 0 }],
      { duration: 520, easing: 'ease-out' }
    );
    a.onfinish = () => r.remove();
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ensure());
  else ensure();
})();`;

// Narration durations (seconds), measured from the synthesized mp3s so beat
// holds fit the voice track. Optional — scripts fall back to their defaults.
export function loadDurations(clipKey) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join("narration", "durations.json"), "utf8"));
    return all[clipKey] ?? {};
  } catch { return {}; }
}

export async function createRecorder({ clip, hashedToken, startPath = "/me", viewport = { width: 1280, height: 800 } }) {
  if (!hashedToken) throw new Error("hashedToken required (from auth admin generate_link)");
  fs.mkdirSync("videos", { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: "videos", size: viewport },
  });
  await context.addInitScript(CURSOR_INIT);
  await context.addCookies(await mintSessionCookies(hashedToken)); // before newPage → no cookie-less frames

  const page = await context.newPage();
  const t0 = Date.now(); // recording starts with the page — first-frame moment
  const pos = { x: 640, y: 400 }; // Node-side cursor mirror (matches init default)
  const beats = [];

  const shot = (name) => page.screenshot({ path: path.join("videos", `frame-${clip}-${name}.png`) }).catch(() => {});

  // ── Sign-in + HARD GATE: refuse to film the wrong page ────────────────────
  await page.goto(`${APP}${startPath}`, { waitUntil: "networkidle" }).catch(() => {});
  await sleep(2000);
  const landed = page.url();
  await shot("signin-check");
  if (landed.includes("/login")) {
    console.error(`FAILED: not signed in — landed on ${landed}. See videos/frame-${clip}-signin-check.png`);
    await context.close(); await browser.close();
    process.exit(1);
  }
  await syncCursor();

  async function syncCursor() {
    await page.evaluate(({ x, y }) => window.__tparCursorTo?.(x, y), pos).catch(() => {});
  }

  // Eased multi-step glide — page.mouse.move fires the mousemove events the
  // overlay tracks, so the rendered cursor travels visibly.
  async function glideTo(x, y, ms = 800) {
    const from = { ...pos };
    const steps = Math.max(8, Math.round(ms / 25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e).catch(() => {});
      await sleep(25);
    }
    pos.x = x; pos.y = y;
  }

  async function slowScroll(toY, ms = 1800) {
    const fromY = await page.evaluate(() => window.scrollY).catch(() => 0);
    const frames = Math.max(1, Math.round(ms / 40));
    for (let i = 1; i <= frames; i++) {
      const y = fromY + ((toY - fromY) * i) / frames;
      await page.evaluate((yy) => window.scrollTo(0, yy), y).catch(() => {});
      await sleep(40);
    }
  }

  async function gotoAndSettle(p, settleMs = 1500) {
    await page.goto(p.startsWith("http") ? p : `${APP}${p}`, { waitUntil: "networkidle" }).catch(() => {});
    await sleep(settleMs);
    await syncCursor(); // new document → overlay re-created at default; re-sync
  }

  function resolve(target) {
    return typeof target === "string" || target instanceof RegExp
      ? page.getByText(target, { exact: false }).first()
      : target;
  }

  // Nearest <section> ancestor (falls back to the element itself) — highlights
  // whole cards instead of bare text nodes.
  async function sectionOf(target) {
    const base = resolve(target);
    const sec = base.locator("xpath=ancestor-or-self::section[1]");
    try { if ((await sec.count()) > 0) return sec.first(); } catch { /* fall through */ }
    return base;
  }

  // ── spotlight(target) — the "pointing" primitive ──────────────────────────
  // Scrolls into view, glides the cursor onto the element, pulses a rounded
  // gold ring around its bounding box while the cursor rests on it.
  // cursorAt: optional { fx, fy } fractions of the box for the cursor rest
  // point (default { fx: 0.5, fy: 0.55 }). Values outside 0..1 park the
  // cursor just OUTSIDE the box — used on live-button surfaces (job-page
  // trigger bar) so the glide target is never a button center.
  async function spotlight(target, { hold = 2500, pulses = 3, pad = 8, shot: shotName = null, moveMs = 900, settleMs = 900, cursorAt = null } = {}) {
    const loc = resolve(target);
    try { await loc.waitFor({ state: "visible", timeout: 6000 }); }
    catch { console.warn(`spotlight: target not visible (${typeof target === "string" ? target : "locator"}) — narration carries the beat`); await sleep(hold); return false; }
    await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })).catch(() => {});
    await sleep(settleMs);
    const box = await loc.boundingBox().catch(() => null);
    if (!box) { console.warn("spotlight: no bounding box — skipping ring"); await sleep(hold); return false; }
    const fx = cursorAt?.fx ?? 0.5;
    const fy = cursorAt?.fy ?? 0.55;
    const cx = Math.min(Math.max(box.x + box.width * fx, 6), viewport.width - 6);
    const cy = Math.min(Math.max(box.y + box.height * fy, 6), viewport.height - 6);
    await glideTo(cx, cy, moveMs);
    await page.evaluate(({ r, pad, pulses }) => {
      const ring = document.createElement("div");
      ring.style.cssText = `position:fixed;left:${r.x - pad}px;top:${r.y - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border:3px solid #d4a017;border-radius:14px;box-shadow:0 0 0 3px rgba(212,160,23,.28),0 0 20px 5px rgba(212,160,23,.38);pointer-events:none;z-index:2147483645;opacity:0;`;
      (document.body || document.documentElement).appendChild(ring);
      const per = 750;
      ring.animate(
        [
          { opacity: 0, transform: "scale(1.035)" },
          { opacity: 1, transform: "scale(1)", offset: 0.35 },
          { opacity: 0.55, transform: "scale(1.02)" },
        ],
        { duration: per, iterations: pulses, easing: "ease-in-out" }
      );
      setTimeout(() => {
        const fade = ring.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 450, fill: "forwards" });
        fade.onfinish = () => ring.remove();
      }, per * pulses);
    }, { r: box, pad, pulses }).catch(() => {});
    let remaining = hold;
    if (shotName) { await sleep(700); remaining -= 700; await shot(shotName); }
    await sleep(Math.max(remaining, 0));
    return true;
  }

  // Click with the cursor already there — mousedown fires the overlay ripple.
  async function clickWith(target) {
    const loc = resolve(target);
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return false;
    await glideTo(box.x + box.width / 2, box.y + box.height / 2, 600);
    await page.mouse.down(); await sleep(90); await page.mouse.up();
    return true;
  }

  // Full-viewport branded title card (swappable host slot). Fade in → hold →
  // fade out. Sits UNDER the cursor overlay; parkCursor() first to keep the
  // arrow out of the frame's center.
  async function titleCard({ title = "TULSA PLUMBING & REMODELING", subtitle = "", hold = 12000 } = {}) {
    await page.evaluate(({ title, subtitle }) => {
      const o = document.createElement("div");
      o.id = "__tpar_title";
      o.style.cssText = "position:fixed;inset:0;z-index:2147483644;background:#0f2247;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;opacity:0;text-align:center;padding:48px;";
      const h = document.createElement("div");
      h.textContent = title;
      h.style.cssText = 'color:#d4a017;font:700 40px/1.25 Georgia,"Times New Roman",serif;letter-spacing:.13em;max-width:900px;';
      const rule = document.createElement("div");
      rule.style.cssText = "width:72px;height:3px;background:#d4a017;border-radius:2px;";
      o.append(h, rule);
      if (subtitle) {
        const s = document.createElement("div");
        s.textContent = subtitle;
        s.style.cssText = "color:rgba(255,255,255,.92);font:400 22px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:.02em;";
        o.append(s);
      }
      (document.body || document.documentElement).appendChild(o);
      o.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: "forwards" });
    }, { title, subtitle }).catch(() => {});
    await sleep(hold);
    await page.evaluate(() => {
      const o = document.getElementById("__tpar_title");
      if (o) {
        const a = o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, fill: "forwards" });
        a.onfinish = () => o.remove();
      }
    }).catch(() => {});
    await sleep(900);
  }

  async function parkCursor() { await glideTo(viewport.width - 44, viewport.height - 36, 500); }

  // ── Beat manifest ──────────────────────────────────────────────────────────
  async function beat(name) {
    const t_ms = Date.now() - t0;
    beats.push({ name, t_ms });
    console.log(`beat ${name} @ ${(t_ms / 1000).toFixed(1)}s`);
    await shot(name); // per-beat screenshot, as before
  }

  async function finish() {
    const beatsPath = path.join("videos", `${clip}-beats.json`);
    fs.writeFileSync(beatsPath, JSON.stringify({ clip, recorded_at: new Date().toISOString(), viewport, beats }, null, 2));
    const raw = await page.video()?.path();
    await context.close();
    await browser.close();
    const finalWebm = path.join("videos", `${clip}.webm`);
    if (raw && fs.existsSync(raw)) {
      if (fs.existsSync(finalWebm)) fs.rmSync(finalWebm);
      fs.renameSync(raw, finalWebm);
    }
    console.log("recorded:", finalWebm);
    console.log("beats:", beatsPath);
    return { videoPath: finalWebm, beatsPath, beats };
  }

  return { page, context, browser, viewport, beat, shot, spotlight, sectionOf, clickWith, gotoAndSettle, glideTo, slowScroll, titleCard, parkCursor, syncCursor, finish };
}
