// /chat — public-facing landing page for the Tulsa Plumbing Pricing Bot.
// No auth required; PUBLIC_PREFIXES allows this through middleware. Backend is
// the public-chat-route edge function, which has origin allowlist + rate
// limits + session caps.

import { PublicChatWidget } from "./PublicChatWidget";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const TPAR_PHONE_DISPLAY = "(918) 800-4426";

export default function ChatPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-brand-700">Tulsa Plumbing &amp; Remodeling</div>
          <h1 className="mt-1 text-2xl font-bold text-neutral-900 sm:text-3xl">Pricing Bot</h1>
        </div>
        <a
          href={`tel:${TPAR_PHONE_DISPLAY.replace(/\D/g, "")}`}
          className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-100 sm:text-sm"
          aria-label="Call us directly"
        >
          Or call {TPAR_PHONE_DISPLAY}
        </a>
      </header>

      <p className="mb-5 text-sm leading-relaxed text-neutral-700">
        Tell me what&apos;s going on — clogged drain, leaky faucet, water heater making noises, whatever it is — and I&apos;ll give you a ballpark range based on similar jobs. Every quote here is reviewed by Danny (the owner) before anyone shows up at your door.
      </p>

      <PublicChatWidget
        supabaseUrl={SUPABASE_URL}
        supabaseAnonKey={SUPABASE_ANON_KEY}
        phoneDisplay={TPAR_PHONE_DISPLAY}
      />

      <footer className="mt-6 space-y-1 text-xs text-neutral-500">
        <p>
          Estimates only. Final price is set after a technician sees the job. Nothing on this page is a binding quote or contract.
        </p>
        <p>
          By chatting, you agree we can store the conversation to follow up with you. We don&apos;t share your info.
        </p>
      </footer>
    </main>
  );
}
