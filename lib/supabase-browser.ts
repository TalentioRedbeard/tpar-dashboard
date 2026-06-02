// Shared browser (anon) Supabase client for client components that need auth —
// phone-OTP sign-in/verify, etc. @supabase/ssr persists the session to cookies
// automatically, which middleware then refreshes. Use the NEXT_PUBLIC_ vars
// (client bundle) — the non-public fallbacks aren't available in the browser.
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
}
