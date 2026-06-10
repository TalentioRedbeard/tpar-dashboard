// TPAR-DB service worker — provides offline read-fallback for techs
// in basements / no-signal job sites. Cache strategy:
//
//   - HTML routes: network-first; cache the response on success.
//     If network fails, serve from cache. If neither, show a tiny
//     offline notice.
//   - Static assets (_next/static, icons, manifest): cache-first.
//   - API / RPC / data calls: never cached. Stale data is a worse UX
//     than an honest "offline" message in this context.
//
// We deliberately keep this thin: no message-passing, no push, no
// background sync. The point is "the page Danny loaded yesterday is
// still readable when his iPhone has 1 bar."

const CACHE = "tpar-db-v3";
const ROUTE_CACHE = "tpar-db-routes-v3";

// Pre-warm ONLY non-sensitive static/PWA assets. Authenticated HTML routes
// (/, /me, /time, /price, ...) are per-user and were leaking across techs:
// Cache Storage is keyed by URL with no cookie partitioning, so the offline
// branch could serve tech A's page to tech B on a shared device. Never cache
// authed navigations.
const PRECACHE_ROUTES = [
  "/manifest.webmanifest",
  "/icon",
  "/icon1",
  "/icon2",
  "/apple-icon",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE_ROUTES).catch(() => undefined)  // best-effort precache
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop old cache versions
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![CACHE, ROUTE_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon" ||
    url.pathname === "/icon1" ||
    url.pathname === "/icon2" ||
    url.pathname === "/apple-icon" ||
    url.pathname === "/favicon.ico"
  );
}

function isAuthPath(url) {
  return url.pathname.startsWith("/login") || url.pathname.startsWith("/auth");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // Don't touch auth flows
  if (isAuthPath(url)) return;

  if (isStaticAsset(url)) {
    // Cache-first for static
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        });
      })
    );
    return;
  }

  // HTML / page routes — network-ONLY. These are per-user authenticated pages;
  // caching them leaks one tech's data to another on a shared device (Cache
  // Storage is URL-keyed, no cookie partitioning). On network failure show a
  // GENERIC offline notice — never a previously-cached page.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(
          `<!doctype html><html><head><title>TPAR-DB · Offline</title>
            <meta charset="utf-8"><meta name="viewport" content="width=device-width">
            <style>
              body{font-family:system-ui,sans-serif;padding:2rem;color:#171717;background:#fafafa}
              .card{max-width:32rem;margin:4rem auto;padding:1.5rem;border:1px solid #e5e5e5;border-radius:1rem;background:#fff}
              h1{margin:0 0 0.5rem;font-size:1.25rem}
              p{margin:0.5rem 0;color:#525252;font-size:0.9rem}
              code{background:#f5f5f5;padding:0.1rem 0.4rem;border-radius:0.25rem}
            </style></head>
            <body><div class="card">
              <h1>You're offline.</h1>
              <p>This page needs a connection to load your latest info.</p>
              <p>Reconnect and try again — your data will be current when you do.</p>
            </div></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
        )
      )
    );
    return;
  }

  // Everything else (API, JSON, image fetches) — pass through. Stale data
  // would be worse than an honest network error here.
});
