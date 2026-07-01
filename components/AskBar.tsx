"use client";

// AskBar — the persistent AI ask bar that sits under the header on every
// page (mounted by PageShell). One slim line: ask a natural-language
// question about the data OR about the page you're on, get a structured
// answer (text / table / map / synthesis) inline, without leaving the page.
//
// Page-aware: passes the current page title + path to the brain, so "what
// is this?" / "what can I do here?" get a page-specific answer, while data
// questions ("my jobs this week") route to SQL. Same backend + role gating
// as /ask (appguide-route). The floating "?" HelpBubble stays as the static
// fallback; this is the live one.

import { useState, useTransition, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { askBar, type AskBarResult } from "../app/ask/bar-action";
import { AskResult } from "./AskResult";

export function AskBar({ pageTitle }: { pageTitle: string }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AskBarResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || pending) return;
    startTransition(async () => {
      // Send the EXACT on-screen URL (path + query string) so the brain can scope
      // to precisely what's displayed — the week/filters live in the URL (?date=,
      // ?view=, ?tech=, ?status=, ?customer=). Read at ask-time from window.location
      // (always current, no useSearchParams/Suspense requirement).
      const loc = typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : pathname;
      const r = await askBar({ question: q, pageContext: `${pageTitle} (${loc})` });
      setResult(r);
    });
  }

  function clear() {
    setResult(null);
    setQuery("");
  }

  return (
    <div className="mb-6">
      <form
        onSubmit={submit}
        className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100"
      >
        <span className="pl-1 text-base leading-none text-brand-600" aria-hidden>✦</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything — about this page or your data…"
          aria-label="Ask TPAR about this page or your data"
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
          autoComplete="off"
        />
        {result && !pending ? (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-700"
          >
            clear
          </button>
        ) : null}
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>

      {pending ? (
        <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          Thinking…
        </div>
      ) : result ? (
        <div className="mt-2">
          {result.ok && result.plan ? (
            <AskResult
              plan={result.plan}
              rows={result.rows ?? []}
              sqlError={result.sql_error ?? null}
              scope={result.scope ?? null}
            />
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {result.error ?? "Couldn't get an answer. Try rephrasing."}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
