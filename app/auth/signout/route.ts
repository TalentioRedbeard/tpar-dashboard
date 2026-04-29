// Sign-out POST handler. Clears the Supabase session cookie and redirects
// to /login.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supa = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(toSet) {
        for (const c of toSet) cookieStore.set(c.name, c.value, c.options);
      },
    },
  });
  await supa.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url));
}
