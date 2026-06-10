// Protects every page except /login and /auth/* routes. Requires a valid
// Supabase session AND that the user's email is on the allow list. Without
// the allow list, anyone with a Google account could sign in.
//
// Also records a page-view row in dashboard_page_views on each authenticated
// real (non-prefetch, non-API) request — fire-and-forget so it never adds
// latency to the response.

import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { toE164US } from "./lib/phone";

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
  // Next emits the icon routes as /icon1, /icon2, /apple-icon (numbered when
  // there are multiple sizes) — whitelist the numbered variants too, or Android
  // "Add to Home Screen" 307-redirects the icon fetch to /login and installs a
  // blank placeholder. iOS is unaffected but include apple-icon for parity.
  "/manifest.webmanifest", "/icon", "/icon1", "/icon2", "/apple-icon",
  // Service worker — must be fetchable at /sw.js without auth so the browser
  // can register it. The SW does not bypass middleware for protected routes;
  // it just caches responses the user already had access to.
  "/sw.js",
  // Public-facing chatbot. No auth required — customers land here from
  // tulsapar.com, social posts, ads, etc. Backend is public-chat-route edge
  // function, which has its own rate limits + origin checks.
  "/chat",
  // Public legal pages for the SMS (A2P 10DLC) messaging program — carrier
  // reviewers + customers must reach these without signing in.
  "/privacy", "/sms-terms",
];

function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.endsWith(`@${ALLOWED_DOMAIN}`)) return true;
  return ALLOWED_EXTRA.includes(e);
}

// Phone-OTP logins have no email, so the email allow-list can't gate them.
// Allow a phone user iff their number matches an ACTIVE tech_directory row
// (service-role read via PostgREST). Only runs for phone users (email === null),
// so the common email path keeps its single getUser() round-trip.
async function isAllowedPhone(phone: string | null | undefined): Promise<boolean> {
  const e164 = toE164US(phone);
  if (!e164 || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tech_directory?select=tech_id&is_active=eq.true&phone=eq.${encodeURIComponent(e164)}&limit=1`,
      {
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    // Network blip reaching PostgREST — fail open so a flaky connection
    // doesn't bounce an otherwise-valid tech to /login. A definitive
    // "not found" (r.ok with empty array) still returns false above.
    return true;
  }
}

// Email logins from a non-tulsapar.com address (e.g. a tech whose only email is
// personal) are allowed iff the address matches an ACTIVE tech_directory row —
// same trust model as isAllowedPhone (the DB is the source of truth, so adding
// or clearing a tech's email instantly grants/revokes access). Only runs AFTER
// the domain + env allow-list already said no, so @tulsapar.com keeps its
// single getUser() round-trip with no extra DB call.
async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tech_directory?select=tech_id&is_active=eq.true&email=ilike.${encodeURIComponent(e)}&limit=1`,
      {
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    // Network blip reaching PostgREST — fail open so a flaky connection
    // doesn't bounce an otherwise-valid tech to /login. A definitive
    // "not found" (r.ok with empty array) still returns false above.
    return true;
  }
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

  const { data: { user }, error: authError } = await supa.auth.getUser();

  // Fail OPEN on a transient network error (flaky LTE): a blip must not look
  // like a signed-out session. Let the request through — page-level
  // getCurrentTech() still resolves the tech row, and a genuinely invalid
  // session (no error, user null) still redirects below.
  if (!user && authError && isAuthRetryableFetchError(authError)) {
    return res;
  }
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", path);
    return NextResponse.redirect(url);
  }

  const allowed = user.email
    ? (isAllowed(user.email) || await isAllowedEmail(user.email))
    : await isAllowedPhone(user.phone);
  if (!allowed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "not_allowed");
    return NextResponse.redirect(url);
  }

  // Authenticated, allow-listed request — record a page view if appropriate.
  // Phone users have no email; log their E.164 as the actor instead.
  const actor = user.email ?? (user.phone ? toE164US(user.phone) : null);
  if (actor && shouldLogPageView(req, path)) {
    recordPageView(req, path, actor);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
