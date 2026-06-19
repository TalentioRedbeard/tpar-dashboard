"use client";

// Market reverse-lookup (step 5, 2026-06-18). Type a part in plumber language → see what
// each vendor charges (real receipt history + confirmed quotes), cheapest-first, with the
// vendor's OWN description (so a fuzzy match is visible, not hidden) and supplier contact.

import { useState, useTransition } from "react";
import { marketLookup, type MarketResult, type MarketVendor } from "../app/shopping/market-actions";

const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${on ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-400"}`}>
      {on ? "✓ " : ""}{label}
    </span>
  );
}

function VendorRow({ v, cheapest }: { v: MarketVendor; cheapest: boolean }) {
  return (
    <li className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2.5 py-1.5 ${cheapest ? "bg-emerald-50" : "bg-neutral-50"}`}>
      <span className={`font-mono text-sm ${cheapest ? "font-semibold text-emerald-800" : "text-neutral-800"}`}>{money(v.cents)}</span>
      <span className="text-sm font-medium text-neutral-900">{v.vendor}</span>
      {cheapest ? <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">cheapest</span> : null}
      <span className={`rounded px-1.5 py-0.5 text-[10px] ${v.source === "quote" ? "bg-brand-100 text-brand-800" : "bg-neutral-200 text-neutral-600"}`}>{v.source}</span>
      <span className="text-xs text-neutral-500">{v.obs}× · {v.last_observed ?? "—"}</span>
      {v.descr ? <span className="w-full truncate font-mono text-[11px] text-neutral-400">{v.descr}</span> : null}
      {cheapest && (v.phone || v.order_email) ? (
        <span className="w-full text-xs text-neutral-500">
          order:{" "}
          {v.phone ? <a href={`tel:${v.phone}`} className="text-brand-700 hover:underline">{v.phone}</a> : null}
          {v.phone && v.order_email ? " · " : ""}
          {v.order_email ? <a href={`mailto:${v.order_email}`} className="text-brand-700 hover:underline">{v.order_email}</a> : null}
        </span>
      ) : null}
    </li>
  );
}

function ResultCard({ r }: { r: MarketResult }) {
  const priced = r.vendor_count > 0;
  const savings = priced && r.hi_cents != null && r.best_cents != null && r.hi_cents > r.best_cents
    ? r.hi_cents - r.best_cents : 0;
  return (
    <li className={`rounded-2xl border border-neutral-200 bg-white p-4 ${priced ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-neutral-900">{r.canonical_name}</span>
        {priced ? (
          <span className="text-sm text-neutral-500">
            best <span className="font-mono font-semibold text-emerald-700">{money(r.best_cents)}</span>
            {r.best_vendor ? ` @ ${r.best_vendor}` : ""}
            {savings > 0 ? <span className="ml-1 text-emerald-700">· save {money(savings)} vs high</span> : null}
          </span>
        ) : (
          <span className="text-xs text-neutral-400">in catalog · no price history yet</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {r.category ? <span className="text-xs text-neutral-500">{r.category}</span> : null}
        <Badge on={r.size_ok} label="size" />
        <Badge on={r.mat_ok} label="material" />
        <Badge on={r.type_ok} label="type" />
      </div>
      {priced ? (
        <ul className="mt-2 space-y-1">
          {r.vendors.map((v, i) => <VendorRow key={`${v.vendor}-${v.source}-${i}`} v={v} cheapest={i === 0} />)}
        </ul>
      ) : null}
    </li>
  );
}

export function MarketLookup() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<MarketResult[] | null>(null);
  const [pending, start] = useTransition();

  function run(e: React.FormEvent) {
    e.preventDefault();
    if (term.trim().length < 2) return;
    start(async () => setResults(await marketLookup(term)));
  }

  // Bucket by match QUALITY first (a wrong-size/type item must never read as "the answer"):
  // exact = size AND type match. Within exact: priced ones are the answer; unpriced are real
  // catalog parts we just have no logged price for. Non-exact = "closest", shown faintly.
  const exact = results?.filter((r) => r.size_ok && r.type_ok) ?? [];
  const exactPriced = exact.filter((r) => r.vendor_count > 0);
  const exactUnpriced = exact.filter((r) => r.vendor_count === 0);
  const loose = results?.filter((r) => !(r.size_ok && r.type_ok)) ?? [];

  return (
    <div className="space-y-3">
      <form onSubmit={run} className="flex gap-2">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="e.g. 3/4 brass tee · 1-1/2 pvc 90 elbow · 1/2 pex ball valve"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button type="submit" disabled={pending || term.trim().length < 2}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:bg-neutral-300">
          {pending ? "Looking…" : "Look up"}
        </button>
      </form>

      {results === null ? (
        <p className="text-xs text-neutral-500">Type a part in plain language — you&rsquo;ll get what each supplier has charged (per piece or per foot), cheapest first, with the number to order from. Prices come from real receipts; each vendor&rsquo;s own wording is shown so you can confirm it&rsquo;s the same part.</p>
      ) : results.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">No catalog match. Try a size + material + part (e.g. &ldquo;3/4 brass tee&rdquo;).</p>
      ) : (
        <>
          {exactPriced.length > 0 ? (
            <ul className="space-y-2">{exactPriced.map((r) => <ResultCard key={r.canonical_item_id} r={r} />)}</ul>
          ) : (
            <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">No <strong>priced</strong> exact match. {exactUnpriced.length > 0 ? "The part is in your catalog (below) but has no logged receipt price yet." : "Closest catalog items are below."}</p>
          )}

          {exactUnpriced.length > 0 ? (
            <div>
              <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">In your catalog · no logged price yet</p>
              <ul className="space-y-2">{exactUnpriced.map((r) => <ResultCard key={r.canonical_item_id} r={r} />)}</ul>
            </div>
          ) : null}

          {loose.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-neutral-500">{loose.length} closest match{loose.length === 1 ? "" : "es"} (not an exact size/type — check the badges)</summary>
              <ul className="mt-2 space-y-2">{loose.map((r) => <ResultCard key={r.canonical_item_id} r={r} />)}</ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
