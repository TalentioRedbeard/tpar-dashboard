// Sign-in page. Two paths:
//  1. Google OAuth — needs the Google provider configured in Supabase. The
//     button posts to /auth/google which kicks off the OAuth flow.
//  2. Email magic-link — works without any Supabase provider config beyond
//     the default email auth that ships enabled. Posts to /auth/email.
// Allow-list enforcement happens in middleware.ts.

"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-neutral-500">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const params = useSearchParams();
  const errorParam = params.get("error");
  const fromParam = params.get("from") ?? "/";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supa = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function signInGoogle() {
    setStatus("sending");
    const { error } = await supa.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(fromParam)}` },
    });
    if (error) { setErrorMsg(error.message); setStatus("error"); }
  }

  async function signInEmail(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(fromParam)}` },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">TPAR-DB Dashboard</h1>
        <p className="mt-2 text-sm text-neutral-600">Sign in with your TPAR Google account or by email link.</p>

        {errorParam === "not_allowed" && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            That account isn't on the access list. Use a tulsapar.com email or contact Danny.
          </div>
        )}

        <button
          onClick={signInGoogle}
          disabled={status === "sending"}
          className="mt-6 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-50"
        >
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-2 text-xs text-neutral-400">
          <div className="h-px flex-1 bg-neutral-200" />
          <span>or</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>

        <form onSubmit={signInEmail} className="space-y-3">
          <input
            type="email"
            required
            placeholder="you@tulsapar.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "sending" || !email}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {status === "sending" ? "Sending..." : "Send magic link"}
          </button>
        </form>

        {status === "sent" && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Check {email} for a sign-in link. It expires in 1 hour.
          </div>
        )}
        {status === "error" && errorMsg && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
      </div>
    </main>
  );
}
