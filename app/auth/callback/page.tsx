// OAuth / magic-link callback. Supabase delivers users here after Google
// or email confirmation in two possible shapes:
//
//   1. PKCE flow (default for user-initiated sign-in):
//      ?code=<exchange_code>  → exchange for session
//
//   2. Implicit flow (admin-generated magic-links via supabase.auth.admin.generateLink):
//      #access_token=<jwt>&refresh_token=<jwt>...  → setSession directly
//
// We handle both. Client component because (2) needs to read window.location.hash.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Suspense } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get("code");
  const next = params.get("next") ?? "/";
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const supa = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    (async () => {
      try {
        if (code) {
          // PKCE flow
          const { error } = await supa.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (typeof window !== "undefined" && window.location.hash) {
          // Implicit flow — parse hash fragment
          const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
          const fragmentParams = new URLSearchParams(hash);
          const access_token = fragmentParams.get("access_token");
          const refresh_token = fragmentParams.get("refresh_token");
          if (!access_token || !refresh_token) {
            const fragErr = fragmentParams.get("error_description") ?? fragmentParams.get("error") ?? "missing tokens in fragment";
            throw new Error(fragErr);
          }
          const { error } = await supa.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
        } else {
          throw new Error("missing_code: no ?code= and no fragment tokens");
        }

        setStatus("ok");
        // Use replace to drop the callback URL (with tokens) from history
        router.replace(next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(msg);
        setStatus("error");
        router.replace(`/login?error=${encodeURIComponent(msg)}`);
      }
    })();
  }, [code, next, router]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 text-center">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8">
        {status === "working" && <p className="text-sm text-neutral-600">Signing you in…</p>}
        {status === "ok" && <p className="text-sm text-emerald-700">Signed in. Redirecting…</p>}
        {status === "error" && (
          <p className="text-sm text-red-700">Sign-in failed: {errorMsg}</p>
        )}
      </div>
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<main className="flex min-h-[60vh] items-center justify-center text-sm text-neutral-500">Loading…</main>}>
      <CallbackInner />
    </Suspense>
  );
}
