"use client";

// ReceiptsBrowser — the gallery framework's receipt sub-panel (spec §5/§8
// Phase 1), built ONCE here and reused when GallerySearchBar arrives in
// Phase 2 (only the data source swaps to the union RPC). Madisson's ask in
// full: Time / Job / Customer / Category / Person(purchaser) + vendor +
// amount + reconciled state, inline change-purchaser, ledger totals.

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { searchReceipts, type BrowseReceipt, type ReceiptFacets } from "@/lib/receipt-browse-actions";
import { reassignReceiptPurchaser } from "@/lib/receipt-reconcile-actions";
import { galleryCustomerSuggest } from "@/lib/gallery-actions";
import type { PurchaserOption } from "@/lib/purchasers";

const CATS: Array<[NonNullable<ReceiptFacets["category"]>, string]> = [
  ["all", "All"], ["job", "On a job"], ["unattributed", "Unattributed"],
  ["gas", "⛽ Gas"], ["tools", "🔧 Tools"], ["office", "🏢 Office"], ["dining", "🍽 Dining"], ["other", "❓ Other"],
];
const DATE_PRESETS: Array<[string, string]> = [
  ["", "All time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"],
];
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function PurchaserCell({ receipt, purchasers }: { receipt: BrowseReceipt; purchasers: PurchaserOption[] }) {
  const [current, setCurrent] = useState(receipt.tech_name ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!editing) {
    return (
      <button type="button" onClick={() => { setEditing(true); setErr(null); }}
        title="Change who this receipt is attributed to"
        className="rounded px-1.5 py-0.5 text-xs text-neutral-600 underline decoration-dotted hover:bg-neutral-100">
        {current || "— nobody —"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          if (!next || next === current) { setEditing(false); return; }
          start(async () => {
            const r = await reassignReceiptPurchaser(receipt.id, next);
            if (r.ok) { setCurrent(r.purchaser); setEditing(false); }
            else setErr(r.error);
          });
        }}
        className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs"
      >
        <option value="">— pick —</option>
        {purchasers.map((p) => (
          <option key={p.shortName} value={p.shortName}>{p.shortName}{p.former ? " (former)" : ""}</option>
        ))}
      </select>
      <button type="button" onClick={() => setEditing(false)} className="text-[10px] text-neutral-400 hover:underline">cancel</button>
      {err ? <span className="text-[10px] text-red-700">{err}</span> : null}
    </span>
  );
}

export function ReceiptsBrowser({ purchasers, initial }: {
  purchasers: PurchaserOption[];
  initial: { rows: BrowseReceipt[]; totalCount: number; totalAmount: number; pageSize: number };
}) {
  const [q, setQ] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [cat, setCat] = useState<NonNullable<ReceiptFacets["category"]>>("all");
  const [purchaser, setPurchaser] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [invoice, setInvoice] = useState("");
  const [custQuery, setCustQuery] = useState("");
  const [custId, setCustId] = useState("");
  const [custLabel, setCustLabel] = useState("");
  const [custHits, setCustHits] = useState<Array<{ id: string; label: string }>>([]);

  const [rows, setRows] = useState<BrowseReceipt[]>(initial.rows);
  const [totalCount, setTotalCount] = useState(initial.totalCount);
  const [totalAmount, setTotalAmount] = useState(initial.totalAmount);
  const [offset, setOffset] = useState(0);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function facets(nextOffset = 0): ReceiptFacets {
    const days = Number(datePreset);
    return {
      q: q || undefined,
      dateFrom: days ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : undefined,
      category: cat,
      purchaser: purchaser || undefined,
      amountMin: amountMin ? Number(amountMin) : undefined,
      amountMax: amountMax ? Number(amountMax) : undefined,
      invoice: invoice || undefined,
      customerId: custId || undefined,
      offset: nextOffset,
    };
  }

  function run(nextOffset = 0) {
    setErr(null);
    start(async () => {
      const r = await searchReceipts(facets(nextOffset));
      if (!r.ok) { setErr(r.error); return; }
      if (nextOffset > 0) setRows((prev) => [...prev, ...r.rows]);
      else setRows(r.rows);
      setTotalCount(r.totalCount);
      setTotalAmount(r.totalAmount);
      setOffset(nextOffset);
    });
  }

  // Debounced auto-search on any facet change (run is stable-enough by
  // construction — it reads current state via facets() at fire time).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(0), 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, datePreset, cat, purchaser, amountMin, amountMax, invoice, custId]);

  // Customer typeahead (office-only server action; entity-aware).
  useEffect(() => {
    if (custQuery.trim().length < 2) { setCustHits([]); return; }
    const t = setTimeout(async () => {
      const hits = await galleryCustomerSuggest(custQuery).catch(() => []);
      setCustHits(hits.map((h) => ({ id: h.id, label: h.label })));
    }, 300);
    return () => clearTimeout(t);
  }, [custQuery]);

  const inputCls = "rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none";

  return (
    <div>
      {/* ── the signature filter bar (receipt sub-panel) ── */}
      <div className="mb-4 space-y-2 rounded-2xl border-2 border-neutral-300 bg-gradient-to-br from-neutral-50/80 to-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder='vendor, notes, or PO — "winnelson" / "ferguson"'
            className={`${inputCls} min-w-[220px] flex-1`} />
          <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className={inputCls}>
            {DATE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={purchaser} onChange={(e) => setPurchaser(e.target.value)} className={inputCls}
            title="Who filed it — sparse on older batch imports (email/Locke/Winnelson receipts mostly carry no person)">
            <option value="">any person</option>
            {purchasers.map((p) => <option key={p.shortName} value={p.shortName}>{p.shortName}{p.former ? " (former)" : ""}</option>)}
          </select>
          <input value={invoice} onChange={(e) => setInvoice(e.target.value)} inputMode="numeric"
            placeholder="job / invoice #" className={`${inputCls} w-32`} />
          <input value={amountMin} onChange={(e) => setAmountMin(e.target.value)} inputMode="decimal"
            placeholder="$ min" className={`${inputCls} w-20`} />
          <input value={amountMax} onChange={(e) => setAmountMax(e.target.value)} inputMode="decimal"
            placeholder="$ max" className={`${inputCls} w-20`} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CATS.map(([c, label]) => (
            <button key={c} type="button" onClick={() => setCat(c)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${cat === c ? "bg-brand-700 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>
              {label}
            </button>
          ))}
          {/* Customer facet — entity-aware (tethering law) */}
          <span className="relative ml-auto">
            {custId ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
                🏠 {custLabel}
                <button type="button" onClick={() => { setCustId(""); setCustLabel(""); setCustQuery(""); }} className="text-brand-500 hover:text-brand-800">×</button>
              </span>
            ) : (
              <>
                <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)}
                  placeholder="customer…" className={`${inputCls} w-40 py-1 text-xs`} />
                {custHits.length > 0 ? (
                  <span className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-neutral-200 bg-white py-1 text-xs shadow-lg">
                    {custHits.map((h) => (
                      <button key={h.id} type="button"
                        onClick={() => { setCustId(h.id); setCustLabel(h.label); setCustHits([]); }}
                        className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50">
                        {h.label}
                      </button>
                    ))}
                  </span>
                ) : null}
              </>
            )}
          </span>
        </div>
      </div>

      {/* ── ledger line ── */}
      <div className="mb-3 flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold text-neutral-900">{totalCount.toLocaleString()} receipt{totalCount === 1 ? "" : "s"}</span>
        <span className="text-neutral-500">· {money(totalAmount)} total in this view</span>
        {busy ? <span className="text-xs text-brand-700">searching…</span> : null}
        {err ? <span className="text-xs text-red-700">{err}</span> : null}
      </div>

      {/* ── results ── */}
      {rows.length === 0 && !busy ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          Nothing matches these filters.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2">
              {r.photo_url ? (
                <Link href={`/reports/receipts/${r.id}/view`} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.photo_url} alt="" className="h-12 w-12 rounded-md border border-neutral-200 object-cover" loading="lazy" />
                </Link>
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-xs text-neutral-400">no img</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-semibold tabular-nums text-neutral-900">{money(r.amount)}</span>
                  <span className="truncate text-neutral-700">{r.vendor ?? "—"}</span>
                  <span className="text-xs text-neutral-400">{r.transaction_date ?? "no date"}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {r.invoice_number ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">job #{r.invoice_number}</span>
                  ) : r.is_overhead ? (
                    <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">overhead{r.overhead_category ? ` · ${r.overhead_category}` : ""}</span>
                  ) : (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">unattributed</span>
                  )}
                  <span className="text-neutral-400">{r.source}</span>
                  <span className="text-neutral-400">·</span>
                  <PurchaserCell receipt={r} purchasers={purchasers} />
                  {r.purchaser_set_by ? <span className="text-neutral-300" title={`purchaser set by ${r.purchaser_set_by}`}>✎</span> : null}
                </div>
              </div>
              <Link href={`/reports/receipts/${r.id}/view`} className="shrink-0 text-xs text-brand-700 hover:underline">view →</Link>
            </li>
          ))}
        </ul>
      )}

      {rows.length < totalCount ? (
        <div className="mt-3 text-center">
          <button type="button" disabled={busy} onClick={() => run(offset + initial.pageSize)}
            className="rounded-md border border-neutral-300 bg-white px-4 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            {busy ? "…" : `Load more (${(totalCount - rows.length).toLocaleString()} left)`}
          </button>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-neutral-400">
        Ledger view of receipts_master — photos exist for app + Slack uploads (batch imports are paper-less rows).
        Unattributed items also live on the <Link href="/reports/receipts" className="underline">reconcile queue</Link>.
      </p>
    </div>
  );
}
