// Protects every page except /login and /auth/* routes. Requires a valid
// Supabase session AND that the user's email is on the allow list. Without
// the allow list, anyone with a Google account could sign in.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

// Domain allow list (lowercased). Anyone whose email ends in @tulsapar.com gets
// in. Add specific personal addresses as comma-separated list in
// DASHBOARD_ALLOWED_EMAILS env var (lowercased) for non-domain users.
const ALLOWED_DOMAIN = "tulsapar.com";
const ALLOWED_EXTRA = (process.env.DASHBOARD_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const PUBLIC_PREFIXES = ["/login", "/auth", "/_next", "/favicon", "/api/health"];

function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.endsWith(`@${ALLOWED_DOMAIN}`)) return true;
  return ALLOWED_EXTRA.includes(e);
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

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
