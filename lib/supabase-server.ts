// Cookie-bound Supabase client for server components. Use this when you need
// to know who the current user is (auth) — it reads/writes cookies via Next's
// async cookies() API. Distinct from lib/supabase.ts (db()) which uses
// service_role and bypasses RLS for unrestricted data reads.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const c of toSet) cookieStore.set(c.name, c.value, c.options);
        } catch {
          // Server components can't set cookies in a render pass; the
          // middleware refresh handles this case.
        }
      },
    },
  });
}

// Per-request memoized: many server components + actions resolve the session in
// a single render. React cache() collapses them to one auth.getUser() per request
// (scoped to the request, no cross-request leakage).
export const getSessionUser = cache(async function getSessionUser(): Promise<{ id: string; email: string | null; phone: string | null } | null> {
  const supa = await supabaseServer();
  const { data } = await supa.auth.getUser();
  if (!data?.user) return null;
  // phone is populated for phone-OTP logins (email is null in that case).
  return { id: data.user.id, email: data.user.email ?? null, phone: data.user.phone ?? null };
});
