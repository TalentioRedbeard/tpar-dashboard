"use client";

// The Stew Queue section on /conversation — Daily Review slice 2. The nightly
// distill keeps `open_threads` current; this is Danny's view of what's still
// stewing (oldest first, with a "stewing N days" badge) plus manual Resolve /
// Dissolve controls (optional note → resolution + history entry). A collapsed
// "recently settled" strip shows the last 14 days of closures.

import { useState, useTransition } from "react";
import { settleThread, type OpenThreadRow } from "@/app/conversation/stew-actions";

export type StewThread = OpenThreadRow & { stewing_days: number };
export type SettledThread = { id: string; title: string; status: string; resolution: string | null; last_updated: string };

type SettleAction = "resolved" | "dissolved";

function ThreadCard({ thread }: { thread: StewThread }) {
  const [confirming, setConfirming] = useState<SettleAction | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const last = thread.history.length > 1 ? thread.history[thread.history.length - 1] : null;

  const settle = (action: SettleAction) => {
    setError(null);
    startTransition(async () => {
      const r = await settleThread({ id: thread.id, action, note });
      if (!r.ok) setError(r.error);
      // On success revalidatePath refreshes the list; the card leaves the queue.
    });
  };

  return (
    <li className="space-y-2 rounded-md border border-gold-500/30 bg-gold-500/[0.06] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-navy-900">{thread.title}</p>
        <span className="shrink-0 rounded-full bg-gold-500/20 px-2 py-0.5 text-[11px] font-medium text-navy-900/70">
          stewing {thread.stewing_days} {thread.stewing_days === 1 ? "day" : "days"}
        </span>
      </div>
      {thread.body && <p className="whitespace-pre-wrap text-navy-900/80">{thread.body}</p>}
      {last && (
        <p className="text-xs text-navy-900/60">
          <span className="font-medium">{last.date}</span>
          {last.note ? ` — ${last.note}` : last.action ? ` — ${last.action}` : null}
        </p>
      )}

      {confirming === null ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => { setConfirming("resolved"); setNote(""); setError(null); }}
            className="rounded-md border border-navy-900/15 bg-white px-2.5 py-1 text-xs font-medium text-navy-900 transition hover:bg-navy-900/[0.04]"
          >
            Resolve
          </button>
          <button
            type="button"
            onClick={() => { setConfirming("dissolved"); setNote(""); setError(null); }}
            className="rounded-md border border-navy-900/15 bg-white px-2.5 py-1 text-xs font-medium text-navy-900/60 transition hover:bg-navy-900/[0.04]"
          >
            Dissolve
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={confirming === "resolved" ? "How it landed (optional)" : "Why it stopped mattering (optional)"}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-navy-900/15 bg-white px-2.5 py-1 text-xs text-navy-900 placeholder:text-navy-900/40 focus:border-gold-500/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => settle(confirming)}
            disabled={pending}
            className="rounded-md bg-navy-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60"
          >
            {pending ? "Saving…" : confirming === "resolved" ? "Resolve" : "Dissolve"}
          </button>
          <button
            type="button"
            onClick={() => { setConfirming(null); setError(null); }}
            disabled={pending}
            className="text-xs text-navy-900/50 transition hover:text-navy-900"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">Couldn&apos;t save: {error}</p>}
    </li>
  );
}

export function StewQueuePanel({ open, settled }: { open: StewThread[]; settled: SettledThread[] }) {
  return (
    <section className="space-y-5 rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-navy-900">Stew Queue</h2>
        <p className="text-xs text-navy-900/60">
          Threads left to stew — the nightly review keeps them warm; settle them here when they land or fade.
        </p>
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-navy-900/50">Nothing stewing — the queue is clear.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((t) => (
            <ThreadCard key={t.id} thread={t} />
          ))}
        </ul>
      )}

      {settled.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-navy-900/50 transition hover:text-navy-900">
            Recently settled (last 14 days) · {settled.length}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {settled.map((t) => (
              <li key={t.id} className="border-l-2 border-navy-900/20 pl-3 text-sm text-navy-900/80">
                <span className="font-medium text-navy-900">{t.title}</span>
                <span className={t.status === "resolved" ? "text-emerald-700" : "text-navy-900/50"}> · {t.status}</span>
                {t.resolution ? <span className="text-navy-900/60"> — {t.resolution}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
