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

const CACHE = "tpar-db-v1";
const ROUTE_CACHE = "tpar-db-routes-v1";

// Pages to pre-warm on install. Static + likely-revisited.
const PRECACHE_ROUTES = [
  "/",
  "/manifest.webmanifest",
  "/icon",
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

  // HTML / page routes — network-first with cache fallback
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          // Only cache successful responses
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(ROUTE_CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() =>
          caches.match(req).then((hit) =>
            hit || new Response(
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
                  <p>This page hasn't been visited recently enough to cache.</p>
                  <p>Try a page you've opened today, like <code>/</code> or a customer/job you visited recently.</p>
                </div></body></html>`,
              { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
            )
          )
        )
    );
    return;
  }

  // Everything else (API, JSON, image fetches) — pass through. Stale data
  // would be worse than an honest network error here.
});
