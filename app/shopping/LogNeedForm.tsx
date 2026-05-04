"use client";

import { useState, useTransition } from "react";
import { logNeed, type Urgency } from "./actions";

const URGENCY_OPTIONS: Array<{ value: Urgency; label: string; emoji: string }> = [
  { value: "asap",       label: "ASAP",       emoji: "🚨" },
  { value: "today",      label: "Today",      emoji: "⏰" },
  { value: "this_week",  label: "This week",  emoji: "📅" },
  { value: "this_month", label: "This month", emoji: "🗓" },
  { value: "no_rush",    label: "No rush",    emoji: "⌛" },
];

export function LogNeedForm({
  canWrite,
  defaultJobId = "",
  onSubmittedAction,
}: {
  canWrite: boolean;
  defaultJobId?: string;
  onSubmittedAction?: (id: string) => void;
}) {
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("this_week");
  const [hcpJobId, setHcpJobId] = useState(defaultJobId);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canWrite) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
        Manager view — read-only. Needs can be logged by Danny or a tech.
      </div>
    );
  }

  return (
    <form
      className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        if (!item.trim()) return;
        startTransition(async () => {
          const res = await logNeed({
            item_description: item,
            qty: qty || undefined,
            urgency,
            hcp_job_id: hcpJobId || undefined,
            location_label: location || undefined,
            notes: notes || undefined,
          });
          if (res.ok) {
            setSuccess("Logged.");
            setItem("");
            setQty("");
            setLocation("");
            setNotes("");
            // Don't reset urgency or hcpJobId — likely to log a sibling item
            onSubmittedAction?.(res.need_id);
          } else {
            setError(res.error);
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px]">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">Item</label>
          <input
            type="text"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder='e.g., 3 ABS 2-inch tees'
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">Qty</label>
          <input
            type="text"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="optional"
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">Urgency</label>
        <div className="flex flex-wrap gap-2">
          {URGENCY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setUrgency(o.value)}
              className={
                urgency === o.value
                  ? "rounded-full px-3 py-1.5 text-sm font-medium bg-brand-600 text-white shadow-sm"
                  : "rounded-full px-3 py-1.5 text-sm bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }
            >
              <span className="mr-1">{o.emoji}</span>{o.label}
            </button>
          ))}
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-700">More context (optional)</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">For job (HCP job id)</label>
            <input
              type="text"
              value={hcpJobId}
              onChange={(e) => setHcpJobId(e.target.value)}
              placeholder="job_..."
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">Location / where</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder='e.g., "van 3 - upper bin", "shop"'
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything that'd help research / decide"
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !item.trim()}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {isPending ? "Logging…" : "Log need"}
        </button>
        {success ? <span className="text-xs text-emerald-700">{success}</span> : null}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
