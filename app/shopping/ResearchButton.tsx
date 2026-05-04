"use client";

import { useState, useTransition } from "react";
import { researchNeed, getResearchForNeed, type ResearchResult } from "./actions";

export function ResearchButton({
  needId,
  initialResults,
}: {
  needId: string;
  initialResults: ResearchResult[];
}) {
  const [results, setResults] = useState<ResearchResult[]>(initialResults);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fmtMoney = (cents: number | null) =>
    cents == null ? "—" : `$${(cents / 100).toLocaleString()}`;

  return (
    <div className="mt-3 rounded-md bg-neutral-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Research
          {results.length > 0 ? (
            <span className="ml-2 text-neutral-400 normal-case font-normal">
              {results.length} candidate{results.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await researchNeed(needId);
              if (!r.ok) {
                setError(r.error);
                return;
              }
              const fresh = await getResearchForNeed(needId);
              setResults(fresh);
            });
          }}
          className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {isPending ? "Researching…" : results.length > 0 ? "Re-research" : "Research"}
        </button>
      </div>

      {error ? <div className="mb-2 text-xs text-red-700">{error}</div> : null}

      {results.length === 0 ? (
        <p className="text-xs text-neutral-500">Tap Research to get vendor + price suggestions.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {results.slice(0, 5).map((r) => (
            <li key={r.id} className="rounded border border-neutral-200 bg-white p-2">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-semibold text-neutral-900">{r.vendor}</span>
                <span className="text-neutral-700">{r.product_name}</span>
                {r.sku ? <span className="font-mono text-[10px] text-neutral-500">SKU {r.sku}</span> : null}
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener" className="text-brand-700 hover:underline">link →</a>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-neutral-600">
                {r.unit_price_cents != null ? <span>{fmtMoney(r.unit_price_cents)} ea</span> : null}
                {r.total_price_cents != null ? <span>· total ~{fmtMoney(r.total_price_cents)}</span> : null}
                {r.in_stock != null ? <span>· {r.in_stock ? "in stock" : "check stock"}</span> : null}
              </div>
              {r.notes ? <p className="mt-1 italic text-neutral-500">{r.notes}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {results.length > 0 ? (
        <p className="mt-2 text-[10px] text-neutral-400">
          Source: {results[0].source}. Pricing is directional, not authoritative — verify on vendor site before purchase.
        </p>
      ) : null}
    </div>
  );
}
