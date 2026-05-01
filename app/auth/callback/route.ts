// OAuth + magic-link PKCE callback. Server-side route handler.
//
// Why server-side: the PKCE code verifier cookie was unreliable when read
// from createBrowserClient (intermittent failures across browsers, even in
// InPrivate windows). Reading cookies directly from the request via
// createServerClient is the canonical Supabase + Next.js App Router pattern
// and Just Works.
//
// This handles the standard signInWithOAuth(google) and signInWithOtp paths,
// both of which return ?code=. Admin-generated magic links use implicit flow
// (#access_token in fragment) and route to /auth/callback/implicit instead —
// fragments aren't sent to the server, so they need client-side handling.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "../../../lib/supabase-server";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Implicit flow puts tokens in the URL fragment — fragments aren't sent
  // to the server. If somebody hits /auth/callback with a fragment-bearing
  // URL (admin-generated magic link mis-redirected here), bounce them to
  // the implicit handler which can read window.location.hash.
  if (!code) {
    return NextResponse.redirect(`${origin}/auth/callback/implicit?next=${encodeURIComponent(next)}`);
  }

  try {
    const supa = await supabaseServer();
    const { error } = await supa.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(msg)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
