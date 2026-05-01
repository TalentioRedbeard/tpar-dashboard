// Implicit-flow callback. Reads access_token + refresh_token from the URL
// fragment and calls setSession. Used for admin-generated magic links
// (supabase.auth.admin.generateLink) which return tokens in #fragment.
//
// User-initiated OAuth + magic links use the PKCE flow at /auth/callback
// (server-side route handler). This client-component path is the implicit
// fallback.

"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function ImplicitInner() {
  const router = useRouter();
  const params = useSearchParams();
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
        if (typeof window === "undefined") throw new Error("no window");
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;
        if (!hash) throw new Error("no fragment tokens — open the magic link in the same browser you requested it from");

        const fragmentParams = new URLSearchParams(hash);
        const access_token = fragmentParams.get("access_token");
        const refresh_token = fragmentParams.get("refresh_token");
        if (!access_token || !refresh_token) {
          const fragErr =
            fragmentParams.get("error_description") ??
            fragmentParams.get("error") ??
            "missing access_token/refresh_token in fragment";
          throw new Error(fragErr);
        }

        const { error } = await supa.auth.setSession({ access_token, refresh_token });
        if (error) throw error;
        setStatus("ok");
        router.replace(next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(msg);
        setStatus("error");
        router.replace(`/login?error=${encodeURIComponent(msg)}`);
      }
    })();
  }, [next, router]);

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

export default function ImplicitCallbackPage() {
  return (
    <Suspense fallback={<main className="flex min-h-[60vh] items-center justify-center text-sm text-neutral-500">Loading…</main>}>
      <ImplicitInner />
    </Suspense>
  );
}
