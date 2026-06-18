"use client";

// Receipt reconciliation queue (#2, 2026-06-18). One card per unattributed receipt; the
// office attaches it to a job (auto-suggested by tech+date, or via project search) or marks
// it overhead. Reconciled cards drop off the list. Leadership-only (admin + manager).

import { useState } from "react";
import {
  suggestForReceipt,
  searchProjectsForReceipt,
  attachReceiptToJob,
  markReceiptsOverhead,
  type UnlinkedReceipt,
  type UnlinkedSummary,
  type ReceiptJobSuggestion,
  type ReceiptProjectMatch,
} from "../lib/receipt-reconcile-actions";

const money = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ReceiptCard({ r, onDone, selected, onToggle }: { r: UnlinkedReceipt; onDone: (id: number) => void; selected: boolean; onToggle: (id: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<ReceiptJobSuggestion[] | null>(null);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<ReceiptProjectMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadSuggest() {
    setSuggest([]);
    setSuggest(await suggestForReceipt(r.id));
  }
  async function doSearch(v: string) {
    setQ(v);
    if (v.trim().length < 2) { setMatches([]); return; }
    setSearching(true);
    setMatches(await searchProjectsForReceipt(v));
    setSearching(false);
  }
  async function attach(trunk: string) {
    setBusy(true); setErr(null);
    const res = await attachReceiptToJob(r.id, trunk);
    if (res.ok) onDone(r.id); else { setErr(res.error); setBusy(false); }
  }
  async function overhead() {
    setBusy(true); setErr(null);
    const res = await markReceiptsOverhead([r.id]);
    if (res.ok) onDone(r.id); else { setErr(res.error); setBusy(false); }
  }

  return (
    <li className={`rounded-2xl border border-neutral-200 bg-white p-4 ${busy ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(r.id)}
          disabled={busy}
          aria-label="select for bulk action"
          className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold text-neutral-900">{r.vendor ?? "(unknown vendor)"}</span>
            <span className="font-mono text-neutral-900">{money(r.amount)}</span>
            <span className="text-xs text-neutral-500">{r.transaction_date ?? "no date"} · {r.source ?? "?"}{r.tech_name ? ` · ${r.tech_name}` : ""}</span>
            <button
              type="button"
              onClick={() => window.open(`/reports/receipts/${r.id}/view`, `receipt_${r.id}`, "popup,width=560,height=760")}
              className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
            >
              View receipt ↗
            </button>
          </div>
          {r.raw_po ? (
            <p className="mt-0.5 text-xs text-neutral-600">
              <span className="text-neutral-400">memo:</span> <span className="font-mono text-neutral-700">{r.raw_po}</span>
            </p>
          ) : null}
          {r.line_items.length ? (
            <ul className="mt-1 text-xs text-neutral-500">
              {r.line_items.slice(0, 5).map((li, i) => (
                <li key={i} className="truncate">• {li.description ?? "item"}{li.quantity ? ` ×${li.quantity}` : ""}{li.line_total != null ? ` — ${money(Number(li.line_total))}` : ""}</li>
              ))}
              {r.line_items.length > 5 ? <li className="text-neutral-400">+{r.line_items.length - 5} more…</li> : null}
            </ul>
          ) : null}
        </div>
        {r.photo_url ? (
          <a href={r.photo_url} target="_blank" rel="noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.photo_url} alt="receipt" className="h-16 w-16 rounded-md border border-neutral-200 object-cover" />
          </a>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {r.has_tech ? (
          <button type="button" onClick={loadSuggest} disabled={busy} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
            Suggest jobs ({r.tech_name})
          </button>
        ) : null}
        <input
          type="search"
          value={q}
          onChange={(e) => doSearch(e.target.value)}
          placeholder="attach to a project (customer / invoice)…"
          className="w-64 rounded-md border border-neutral-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button type="button" onClick={overhead} disabled={busy} className="ml-auto rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
          Mark overhead
        </button>
      </div>

      {suggest && suggest.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggest.map((s) => (
            <button key={s.trunk} type="button" onClick={() => attach(s.trunk)} disabled={busy}
              className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-100">
              #{s.trunk} · {s.customerName ?? "?"} · {s.jobDate ?? ""}{s.dayGap === 0 ? " (same day)" : ` (±${s.dayGap}d)`}
            </button>
          ))}
        </div>
      ) : suggest && suggest.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-400">No tech+date match — attach via search or mark overhead.</p>
      ) : null}

      {q.trim().length >= 2 ? (
        <ul className="mt-2 max-h-56 overflow-auto rounded-md border border-neutral-200 bg-white">
          {searching && matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-400">Searching…</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-400">No projects match.</li>
          ) : (
            matches.map((m) => (
              <li key={m.trunk}>
                <button type="button" onClick={() => attach(m.trunk)} disabled={busy}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50">
                  <span className="truncate text-neutral-900">#{m.trunk} · {m.customerName ?? "?"}</span>
                  <span className="shrink-0 text-xs text-neutral-500">{m.jobCount} job{m.jobCount === 1 ? "" : "s"}{m.lastDate ? ` · ${m.lastDate}` : ""}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
    </li>
  );
}

export function ReceiptReconcileList({ initialRows, summary, sources, activeSource }: {
  initialRows: UnlinkedReceipt[];
  summary: UnlinkedSummary;
  sources: string[];
  activeSource: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [cleared, setCleared] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const remove = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setCleared((n) => n + 1);
  };
  const toggle = (id: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function bulkOverhead() {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    const res = await markReceiptsOverhead(ids);
    if (res.ok) {
      const removed = new Set(ids);
      setRows((prev) => prev.filter((r) => !removed.has(r.id)));
      setSelected(new Set());
      setCleared((n) => n + res.n);
    }
    setBulkBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <span className="font-semibold text-neutral-900">{summary.count.toLocaleString()}</span> unattributed receipts ·{" "}
        <span className="font-semibold text-neutral-900">{money(summary.total)}</span> of material spend not yet on any job.
        {summary.emailCount ? <> Largest source: <span className="font-medium">email supplier invoices</span> ({summary.emailCount.toLocaleString()} · {money(summary.emailTotal)}).</> : null}
        {cleared ? <span className="ml-2 text-emerald-700">· {cleared} reconciled this session.</span> : null}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <a href="/reports/receipts" className={`rounded-full px-3 py-1 ${!activeSource ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>all</a>
        {sources.map((s) => (
          <a key={s} href={`/reports/receipts?source=${encodeURIComponent(s)}`} className={`rounded-full px-3 py-1 ${activeSource === s ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>{s}</a>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs">
          <button type="button" onClick={() => setSelected(new Set(rows.map((r) => r.id)))} className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-50">
            Select all ({rows.length})
          </button>
          {selected.size > 0 ? (
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-md border border-neutral-300 px-2.5 py-1 text-neutral-600 hover:bg-neutral-50">Clear</button>
          ) : null}
          <span className="text-neutral-500">{selected.size} selected</span>
          <button
            type="button"
            onClick={bulkOverhead}
            disabled={selected.size === 0 || bulkBusy}
            className="ml-auto rounded-md border border-amber-300 bg-amber-50 px-3 py-1 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {bulkBusy ? "Marking…" : `Mark ${selected.size || ""} overhead`}
          </button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">Nothing left to reconcile here. 🎉</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => <ReceiptCard key={r.id} r={r} onDone={remove} selected={selected.has(r.id)} onToggle={toggle} />)}
        </ul>
      )}
    </div>
  );
}
