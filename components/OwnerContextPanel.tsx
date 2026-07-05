"use client";

// Owner context review panel on /conversation — power-center-point slice 3.
// The ON-PREM worker extracts durable ideology / perspective / know-how notes
// from Danny's ambient days into owner_context (status='pending_review'); this
// is the review gate — nothing is "kept" until he keeps it here.

import { useState, useTransition } from "react";
import { reviewOwnerContext } from "@/app/conversation/wrap-actions";

export type OwnerContextItem = {
  id: string;
  context_date: string;
  category: string; // 'ideology' | 'perspective' | 'know-how' | 'values' | 'vision'
  content: string;
  evidence: string | null;
};

function ContextCard({ item }: { item: OwnerContextItem }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const review = (decision: "kept" | "rejected") => {
    setError(null);
    startTransition(async () => {
      const r = await reviewOwnerContext({ id: item.id, decision });
      if (!r.ok) setError(r.error);
      // On success revalidatePath refreshes the list; the card leaves the queue.
    });
  };

  return (
    <li className="space-y-2 rounded-md border border-navy-900/10 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-full bg-gold-500/20 px-2 py-0.5 text-[11px] font-medium text-navy-900/70">
          {item.category}
        </span>
        <p className="min-w-0 flex-1 text-sm text-navy-900/90">{item.content}</p>
      </div>
      {item.evidence && (
        <p className="border-l-2 border-navy-900/20 pl-3 text-xs italic text-navy-900/60">&ldquo;{item.evidence}&rdquo;</p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => review("kept")}
          disabled={pending}
          className="rounded-md bg-navy-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={() => review("rejected")}
          disabled={pending}
          className="rounded-md border border-navy-900/15 bg-white px-2.5 py-1 text-xs font-medium text-navy-900/60 transition hover:bg-navy-900/[0.04] disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      {error && <p className="text-xs text-red-700">Couldn&apos;t save: {error}</p>}
    </li>
  );
}

export function OwnerContextPanel({ pending, keptCount }: { pending: OwnerContextItem[]; keptCount: number }) {
  // Group by context_date desc (page query already orders context_date desc).
  const byDate = new Map<string, OwnerContextItem[]>();
  for (const item of pending) {
    const list = byDate.get(item.context_date) ?? [];
    list.push(item);
    byDate.set(item.context_date, list);
  }

  return (
    <section className="space-y-5 rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy-900">Owner context</h2>
          <p className="text-xs text-navy-900/60">
            What the on-prem worker heard in your thinking — keep what&apos;s truly yours, reject the noise.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-navy-900/[0.05] px-2.5 py-1 text-xs font-medium text-navy-900/70">
          {keptCount} kept · {pending.length} pending
        </span>
      </div>

      {pending.length === 0 ? (
        <p className="text-sm text-navy-900/50">Nothing waiting on review.</p>
      ) : (
        <div className="space-y-4">
          {[...byDate.entries()].map(([date, items]) => (
            <div key={date} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-900/50">{date}</h3>
              <ul className="space-y-2">
                {items.map((item) => (
                  <ContextCard key={item.id} item={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
