"use client";

// HelpBubble — floating "?" button at the bottom-right of every page.
//
// Click → slides up a panel with page-aware "what this is for / what
// you can do here / examples." Built for techs who weren't hired for
// tech literacy — content is short, casual, and one-glance.
//
// Each page passes its own help content. If no content is passed,
// the bubble still renders with a generic "ask me anything" link
// pointing at /ask (Slice B will replace that with an in-bubble
// command palette).

import { useState, useEffect, type ReactNode } from "react";

export type HelpContent = {
  /** One-sentence "what is this page for?" — casual, not formal. */
  intent: string;
  /** Things they can DO here. Each is a short verb-led line. */
  actions?: string[];
  /** Optional "if you're stuck" follow-ups (link to another page, a Slack channel, etc). */
  stuck?: ReactNode;
};

const GENERIC: HelpContent = {
  intent: "This page is part of the TPAR dashboard. Hit the buttons to do the things they say. If something is confusing, ping Danny.",
  actions: [
    "Look around — nothing here can break by being clicked.",
    "Hit ← Back if you got here by accident.",
  ],
};

export function HelpBubble({ content }: { content?: HelpContent }) {
  const c = content ?? GENERIC;
  const [open, setOpen] = useState(false);

  // Session-dismissable: once they close it, don't auto-pop. (Right now we
  // never auto-pop — they have to click. Keeping the state setup so a future
  // "first-visit pulse" can hook in without a redesign.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Floating "?" button — always visible bottom-right */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="What can I do on this page?"
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-2xl font-semibold text-white shadow-lg shadow-brand-900/30 transition hover:bg-brand-700 hover:shadow-xl active:scale-95 md:bottom-6 md:right-6"
      >
        {open ? "×" : "?"}
      </button>

      {/* Slide-up panel */}
      {open ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 flex justify-end px-4 pb-20 md:px-6 md:pb-24"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pointer-events-auto w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl shadow-neutral-900/20"
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-neutral-900">What this page is for</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-neutral-500 hover:text-neutral-800"
              >
                close (Esc)
              </button>
            </div>

            <p className="text-sm leading-relaxed text-neutral-800">{c.intent}</p>

            {c.actions && c.actions.length > 0 ? (
              <>
                <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  What you can do here
                </div>
                <ul className="mt-2 space-y-1.5">
                  {c.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-neutral-800">
                      <span className="mt-0.5 text-brand-700">→</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {c.stuck ? (
              <>
                <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Still stuck?
                </div>
                <div className="mt-2 text-sm text-neutral-700">{c.stuck}</div>
              </>
            ) : null}

            <div className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
              Type a question on <a href="/ask" className="font-medium underline hover:text-neutral-800">/ask</a> if your situation isn&apos;t covered here. Or text Danny.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
