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
import { BrandMark } from "../../components/ui/Brand";

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

  // Default flow (PKCE). The PKCE verifier is stored in a cookie by
  // @supabase/ssr; /auth/callback is now a server-side Route Handler
  // that reads the cookie reliably via createServerClient.
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
    <main className="flex min-h-screen flex-1 flex-col bg-neutral-50 md:flex-row">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-brand-800 px-10 py-14 md:flex md:w-[44%] md:flex-col md:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(245,158,11,0.35), transparent 40%), radial-gradient(circle at 80% 80%, rgba(96,165,250,0.45), transparent 40%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark size={40} />
          <div className="leading-tight">
            <div className="text-xl font-semibold text-white">TPAR<span className="text-accent-500">·</span>DB</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-brand-200">Operations console</div>
          </div>
        </div>
        <div className="relative space-y-6">
          <h2 className="text-3xl font-semibold leading-snug text-white">
            The single pane for Tulsa Plumbing &amp; Remodeling.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-brand-100">
            Customers, jobs, comms, dispatch, estimates, and reports in one
            place — built around how the team actually works.
          </p>
          <ul className="space-y-2 text-sm text-brand-100">
            {["Transparency", "Ownership", "Professionalism"].map((v) => (
              <li key={v} className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-500" />
                {v}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-brand-200">
          tulsapar.com · internal
        </div>
      </aside>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 md:hidden">
            <BrandMark size={28} />
            <span className="text-base font-semibold tracking-tight text-neutral-900">
              TPAR<span className="text-brand-700">·</span>DB
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Sign in</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Use your TPAR Google account, or get a one-time link by email.
          </p>

          {errorParam === "not_allowed" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              That account isn&apos;t on the access list. Use a tulsapar.com email or contact Danny.
            </div>
          )}
          {errorParam && errorParam !== "not_allowed" && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {decodeURIComponent(errorParam)}
            </div>
          )}

          <button
            onClick={signInGoogle}
            disabled={status === "sending"}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            <GoogleGlyph />
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-2 text-xs text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200" />
            <span>or sign in with email</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          <form onSubmit={signInEmail} className="space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-neutral-600">Work email</span>
              <input
                type="email"
                required
                placeholder="you@tulsapar.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>
            <button
              type="submit"
              disabled={status === "sending" || !email}
              className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
          </form>

          {status === "sent" && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Check <span className="font-medium">{email}</span> — your link expires in 1 hour.
            </div>
          )}
          {status === "error" && errorMsg && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <p className="mt-8 text-xs text-neutral-500">
            Trouble signing in? Contact{" "}
            <a href="mailto:ddunlop@tulsapar.com" className="font-medium text-brand-700 hover:underline">
              ddunlop@tulsapar.com
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16.1 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.5 4.5 9.9 8.6 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.5c5.2 0 9.8-2 13.3-5.2l-6.2-5.1c-1.9 1.4-4.3 2.3-7.1 2.3-5.1 0-9.5-3.3-11.1-7.9l-6.5 5C9.6 39.3 16.3 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.1c-.4.4 6.7-4.9 6.7-14.8 0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
