"use client";

// Interactive parts catalog (2026-06-18). Filter the in-house catalog by category / material /
// text / priced-only; expand any part to see every vendor's price (receipt + confirmed quote),
// cheapest flagged, with ordering info and delivery terms (honest "not set yet" until captured).

import { useEffect, useRef, useState, useTransition } from "react";
import { loadCatalog, type CatalogItem, type CatalogVendor, type CatalogFacets } from "../app/shopping/catalog-actions";

const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

function deliveryLine(v: CatalogVendor): { text: string; tone: "ok" | "no" | "unknown" } {
  if (v.delivers === true) {
    const bits: string[] = ["Delivers"];
    if (v.lead_days != null) bits.push(v.lead_days === 0 ? "same-day" : `${v.lead_days}d`);
    if (v.fee_cents != null) bits.push(v.fee_cents === 0 ? "free" : `${money(v.fee_cents)} fee`);
    if (v.min_cents != null) bits.push(`min ${money(v.min_cents)}`);
    if (v.cutoff) bits.push(v.cutoff);
    return { text: bits.join(" · "), tone: "ok" };
  }
  if (v.delivers === false) return { text: v.offers_pickup === false ? "No delivery / no pickup" : "Pickup only", tone: "no" };
  return { text: "delivery info not set", tone: "unknown" };
}

function VendorRow({ v, cheapest }: { v: CatalogVendor; cheapest: boolean }) {
  const d = deliveryLine(v);
  return (
    <li className={`rounded-lg px-2.5 py-2 ${cheapest ? "bg-emerald-50" : "bg-neutral-50"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`font-mono text-sm ${cheapest ? "font-semibold text-emerald-800" : "text-neutral-800"}`}>{money(v.cents)}</span>
        <span className="text-sm font-medium text-neutral-900">{v.vendor}</span>
        {cheapest ? <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">cheapest</span> : null}
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${v.source === "quote" ? "bg-brand-100 text-brand-800" : "bg-neutral-200 text-neutral-600"}`}>{v.source}</span>
        <span className="text-xs text-neutral-500">{v.obs}× · {v.last_observed ?? "—"}</span>
      </div>
      {v.descr ? <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-400">{v.descr}</div> : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className={d.tone === "ok" ? "text-emerald-700" : d.tone === "no" ? "text-neutral-500" : "text-amber-600"}>
          🚚 {d.text}
        </span>
        {v.order_email ? <a href={`mailto:${v.order_email}`} className="text-brand-700 hover:underline">order ✉</a> : null}
        {v.phone ? <a href={`tel:${v.phone}`} className="text-brand-700 hover:underline">{v.phone}</a> : null}
        {v.account ? <span className="text-neutral-400">acct {v.account}</span> : null}
      </div>
    </li>
  );
}

function ItemRow({ it, open, onToggle }: { it: CatalogItem; open: boolean; onToggle: () => void }) {
  const priced = it.vendor_count > 0;
  const savings = priced && it.hi_cents != null && it.best_cents != null && it.hi_cents > it.best_cents ? it.hi_cents - it.best_cents : 0;
  return (
    <li className="rounded-2xl border border-neutral-200 bg-white">
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="font-medium text-neutral-900">{it.name}</span>
          {it.category ? <span className="ml-2 text-xs text-neutral-400">{it.category}</span> : null}
        </span>
        <span className="flex items-center gap-2 text-sm">
          {priced ? (
            <>
              <span className="font-mono font-semibold text-emerald-700">{money(it.best_cents)}</span>
              {it.best_vendor ? <span className="hidden text-xs text-neutral-500 sm:inline">@ {it.best_vendor}</span> : null}
              <span className="text-xs text-neutral-400">{it.vendor_count} vendor{it.vendor_count === 1 ? "" : "s"}</span>
              {savings > 0 ? <span className="hidden text-xs text-emerald-700 sm:inline">save {money(savings)}</span> : null}
            </>
          ) : (
            <span className="text-xs text-neutral-400">no price yet</span>
          )}
          <span className="text-neutral-400">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-neutral-100 px-4 py-2">
          {priced ? (
            <ul className="space-y-1.5">{it.vendors.map((v, i) => <VendorRow key={`${v.vendor}-${v.source}-${i}`} v={v} cheapest={i === 0} />)}</ul>
          ) : (
            <p className="py-1 text-sm text-neutral-500">In your catalog, but no logged receipt or confirmed quote yet. Log a receipt for this part or confirm a quote in the reconcile queue and it&rsquo;ll appear here.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

const ALL = "__all__";

export function CatalogBrowser({ initialItems, facets }: { initialItems: CatalogItem[]; facets: CatalogFacets }) {
  const [items, setItems] = useState(initialItems);
  const [category, setCategory] = useState<string>(ALL);
  const [material, setMaterial] = useState<string>(ALL);
  const [pricedOnly, setPricedOnly] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    // Skip the very first run (server already provided initialItems for the default filters).
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      start(async () => {
        setItems(await loadCatalog({
          category: category === ALL ? null : category,
          material: material === ALL ? null : material,
          q,
          pricedOnly,
        }));
      });
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [category, material, pricedOnly, q]);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${active ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCategory(ALL)} className={chip(category === ALL)}>All categories</button>
          {facets.categories.map((c) => <button key={c} type="button" onClick={() => setCategory(c)} className={chip(category === c)}>{c}</button>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setMaterial(ALL)} className={chip(material === ALL)}>Any material</button>
          {facets.materials.map((m) => <button key={m} type="button" onClick={() => setMaterial(m)} className={chip(material === m)}>{m}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search the catalog…"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} className="h-4 w-4 rounded border-neutral-300 accent-brand-600" />
            priced only
          </label>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        <span className="font-semibold text-neutral-700">{items.length}</span> part{items.length === 1 ? "" : "s"}{pending ? " · loading…" : ""}
        {" · "}prices are real (receipts + confirmed quotes), normalized per piece or per foot. Delivery shows what&rsquo;s been captured per supplier.
      </p>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">No parts match these filters.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <ItemRow key={it.id} it={it} open={open.has(it.id)}
              onToggle={() => setOpen((p) => { const n = new Set(p); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} />
          ))}
        </ul>
      )}
    </div>
  );
}
