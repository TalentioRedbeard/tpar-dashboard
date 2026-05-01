// Inline form for creating a maintenance agreement on the customer page.
// Compact — most fields default to sensible values; scope_text is the only
// required input.

"use client";

import { useState, useTransition } from "react";
import { createAgreement } from "../lib/agreement-actions";

export function AgreementForm({
  hcpCustomerId,
  defaultOrigin = "manual",
  prefilledScope = "",
  prefilledCadence = 28,
}: {
  hcpCustomerId: string;
  defaultOrigin?: "manual" | "recurring_jobs" | "repeat_jobs" | "comm_patterns";
  prefilledScope?: string;
  prefilledCadence?: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  const [scope, setScope] = useState(prefilledScope);
  const [cadence, setCadence] = useState<string>(String(prefilledCadence));
  const [price, setPrice] = useState<string>("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (!String(fd.get("scope_text") ?? "").trim()) {
      setError("scope is required");
      return;
    }
    startTransition(async () => {
      const res = await createAgreement(fd);
      if (res.ok) {
        setSavedId(res.id ?? null);
        setScope("");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4">
      <input type="hidden" name="hcp_customer_id" value={hcpCustomerId} />
      <input type="hidden" name="origin_pattern" value={defaultOrigin} />

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          Scope (what's being maintained, on what cadence, why)
        </label>
        <textarea
          name="scope_text"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Preventative jetter pass — bellied building sewer line, prevents recurring clogs"
          disabled={isPending}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Cadence (days)</label>
          <input
            type="number"
            name="cadence_days"
            min={7}
            max={730}
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Base price ($)</label>
          <input
            type="number"
            name="base_price"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="165"
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Starts on</label>
          <input
            type="date"
            name="starts_on"
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending || !scope.trim()}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {isPending ? "Creating…" : "Create agreement"}
        </button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
        {savedId && !error ? (
          <span className="text-xs text-emerald-700">Saved · id {savedId}</span>
        ) : null}
        <span className="ml-auto text-xs text-neutral-500">
          v0: decision capture. Auto-scheduling is v1.
        </span>
      </div>
    </form>
  );
}
