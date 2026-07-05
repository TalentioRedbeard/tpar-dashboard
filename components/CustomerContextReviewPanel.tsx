"use client";

// Customer context review panel on /context — sibling of OwnerContextPanel
// (that one reviews Danny's OWN context; this one reviews CUSTOMER human
// context the on-prem worker mined from comms). Discreet data: each item
// carries a sensitivity tier — 'internal' (any staff) or 'owner_only'
// (delicate; owner's eyes only) — flippable before the keep/reject decision.

import Link from "next/link";
import { useState, useTransition } from "react";
import { reviewCustomerContext, setContextSensitivity } from "@/app/context/actions";

export type CustomerContextItem = {
  id: string;
  category: string; // 'relationship' | 'household' | 'life_event' | 'sensitivity' | 'preference' | 'communication_style'
  content: string;
  evidence: string | null;
  sensitivity: "internal" | "owner_only";
  created_at: string;
};

export type CustomerContextGroup = {
  hcpCustomerId: string;
  displayName: string;
  items: CustomerContextItem[];
};

export type KeptContextItem = {
  id: string;
  category: string;
  content: string;
  sensitivity: "internal" | "owner_only";
  reviewed_at: string | null;
  customerName: string;
};

function categoryLabel(category: string): string {
  return category.replaceAll("_", " ");
}

function SensitivityBadge({ sensitivity }: { sensitivity: "internal" | "owner_only" }) {
  if (sensitivity === "owner_only") {
    return (
      <span className="shrink-0 rounded-full bg-navy-900 px-2 py-0.5 text-[11px] font-semibold text-gold-400">
        🔒 owner only
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-navy-900/15 bg-white px-2 py-0.5 text-[11px] font-medium text-navy-900/50">
      internal
    </span>
  );
}

function ContextItemCard({ item }: { item: CustomerContextItem }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const review = (decision: "kept" | "rejected") => {
    setError(null);
    startTransition(async () => {
      const r = await reviewCustomerContext({ id: item.id, decision });
      if (!r.ok) setError(r.error);
      // On success revalidatePath refreshes the list; the card leaves the queue.
    });
  };

  const flipSensitivity = () => {
    setError(null);
    const next = item.sensitivity === "owner_only" ? "internal" : "owner_only";
    startTransition(async () => {
      const r = await setContextSensitivity({ id: item.id, sensitivity: next });
      if (!r.ok) setError(r.error);
      // On success revalidatePath re-renders with the flipped badge.
    });
  };

  return (
    <li className="space-y-2 rounded-md border border-navy-900/10 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-full bg-gold-500/20 px-2 py-0.5 text-[11px] font-medium text-navy-900/70">
          {categoryLabel(item.category)}
        </span>
        <SensitivityBadge sensitivity={item.sensitivity} />
        <p className="min-w-0 flex-1 text-sm text-navy-900/90">{item.content}</p>
      </div>
      {item.evidence && (
        <p className="border-l-2 border-navy-900/20 pl-3 text-xs italic text-navy-900/60">&ldquo;{item.evidence}&rdquo;</p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
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
        <button
          type="button"
          onClick={flipSensitivity}
          disabled={pending}
          className="ml-auto text-[11px] font-medium text-navy-900/50 underline decoration-navy-900/30 underline-offset-2 transition hover:text-navy-900/80 disabled:opacity-60"
        >
          {item.sensitivity === "owner_only" ? "mark internal" : "mark 🔒 owner only"}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">Couldn&apos;t save: {error}</p>}
    </li>
  );
}

export function CustomerContextReviewPanel({
  groups,
  kept,
  loadError,
}: {
  groups: CustomerContextGroup[];
  kept: KeptContextItem[];
  loadError: string | null;
}) {
  const pendingTotal = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-6">
      <section className="space-y-5 rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-navy-900">Pending review</h2>
            <p className="text-xs text-navy-900/60">
              What the on-prem worker read between the lines of each customer&apos;s comms — keep what&apos;s
              real and useful, reject the noise. Flip anything delicate to 🔒 owner-only before keeping.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-navy-900/[0.05] px-2.5 py-1 text-xs font-medium text-navy-900/70">
            {pendingTotal} pending
          </span>
        </div>

        {loadError ? (
          <p className="text-sm text-red-700">Couldn&apos;t load the queue: {loadError}</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-navy-900/50">Nothing waiting on review.</p>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.hcpCustomerId} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/customer/${group.hcpCustomerId}`}
                    className="text-sm font-semibold text-navy-900 underline decoration-gold-500/60 underline-offset-2 hover:decoration-gold-500"
                  >
                    {group.displayName}
                  </Link>
                  <span className="text-[11px] text-navy-900/40">
                    {group.items.length} item{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <ContextItemCard key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer select-none text-sm font-semibold text-navy-900">
          Recently kept <span className="font-normal text-navy-900/50">(last 14 days · {kept.length})</span>
        </summary>
        {kept.length === 0 ? (
          <p className="mt-3 text-sm text-navy-900/50">Nothing kept in the last 14 days.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {kept.map((item) => (
              <li key={item.id} className="flex items-start gap-2 rounded-md border border-navy-900/[0.07] p-2.5">
                <span className="mt-0.5 shrink-0 rounded-full bg-gold-500/20 px-2 py-0.5 text-[11px] font-medium text-navy-900/70">
                  {categoryLabel(item.category)}
                </span>
                <SensitivityBadge sensitivity={item.sensitivity} />
                <p className="min-w-0 flex-1 text-sm text-navy-900/80">
                  <span className="font-medium text-navy-900">{item.customerName}:</span> {item.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
