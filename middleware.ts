// Protects every page except /login and /auth/* routes. Requires a valid
// Supabase session AND that the user's email is on the allow list. Without
// the allow list, anyone with a Google account could sign in.
//
// Also records a page-view row in dashboard_page_views on each authenticated
// real (non-prefetch, non-API) request — fire-and-forget so it never adds
// latency to the response.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Domain allow list (lowercased). Anyone whose email ends in @tulsapar.com gets
// in. Add specific personal addresses as comma-separated list in
// DASHBOARD_ALLOWED_EMAILS env var (lowercased) for non-domain users.
const ALLOWED_DOMAIN = "tulsapar.com";
const ALLOWED_EXTRA = (process.env.DASHBOARD_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const PUBLIC_PREFIXES = [
  "/login", "/auth", "/_next", "/favicon", "/api/health",
  // PWA assets must be publicly fetchable so the browser can install the app
  // before the user signs in. Manifest + auto-generated icons are non-sensitive.
  "/manifest.webmanifest", "/icon", "/apple-icon",
  // Service worker — must be fetchable at /sw.js without auth so the browser
  // can register it. The SW does not bypass middleware for protected routes;
  // it just caches responses the user already had access to.
  "/sw.js",
  // Public-facing chatbot. No auth required — customers land here from
  // tulsapar.com, social posts, ads, etc. Backend is public-chat-route edge
  // function, which has its own rate limits + origin checks.
  "/chat",
];

function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.endsWith(`@${ALLOWED_DOMAIN}`)) return true;
  return ALLOWED_EXTRA.includes(e);
}

// Decide whether a request is worth logging as a page view. Skip:
//  - API routes — these are app-internal calls, not user navigations
//  - Next.js prefetches — the user hasn't actually navigated yet
//  - Internal Next dev/build assets the matcher already excludes (defensive)
function shouldLogPageView(req: NextRequest, path: string): boolean {
  if (path.startsWith("/api/")) return false;
  if (path.startsWith("/_next")) return false;
  // Next App Router prefetches set this header on background fetches.
  if (req.headers.get("next-router-prefetch") === "1") return false;
  // Server actions land on the original page path with this header. They
  // already happened from a real navigation we logged, so skip the duplicate.
  if (req.headers.get("next-action")) return false;
  return true;
}

// Fire-and-forget POST to PostgREST. We don't await — the response continues
// in parallel. `keepalive: true` asks the runtime to hold the connection
// open even after the response is sent.
function recordPageView(req: NextRequest, path: string, email: string): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const search = req.nextUrl.search ? req.nextUrl.search.slice(0, 500) : null;
  const ua = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const ref = req.headers.get("referer")?.slice(0, 500) ?? null;
  // If the leader has tpar_view_as set, capture which tech they're rendering
  // as. Read the cookie BEFORE @supabase/ssr's setAll mutated res cookies —
  // both sides match for our purposes here. Cookie name lives in
  // lib/current-tech.ts (VIEW_AS_COOKIE).
  const viewAs = req.cookies.get("tpar_view_as")?.value?.trim() || null;
  const body = JSON.stringify({
    user_email: email,
    path,
    search,
    user_agent: ua,
    referer: ref,
    viewed_as: viewAs,
  });
  // Don't await; .catch swallows network/DNS issues so we never disturb
  // the actual user response.
  fetch(`${SUPABASE_URL}/rest/v1/dashboard_page_views`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body,
    keepalive: true,
  }).catch(() => {});
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Public routes — no auth check
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Build a response we can mutate cookies on (Supabase ssr-helpers pattern)
  let res = NextResponse.next({ request: req });
  const supa = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet) {
        for (const c of toSet) {
          req.cookies.set(c.name, c.value);
          res = NextResponse.next({ request: req });
          res.cookies.set(c.name, c.value, c.options);
        }
      },
    },
  });

  const { data: { user } } = await supa.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", path);
    return NextResponse.redirect(url);
  }

  if (!isAllowed(user.email)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "not_allowed");
    return NextResponse.redirect(url);
  }

  // Authenticated, allow-listed request — record a page view if appropriate.
  if (user.email && shouldLogPageView(req, path)) {
    recordPageView(req, path, user.email);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
