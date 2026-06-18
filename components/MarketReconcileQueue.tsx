"use client";

// Market reconcile queue (step 3, 2026-06-18). One card per unconfirmed vendor line; confirm
// the proposed canonical match, pick a better candidate (size/material/type-aware), search
// the catalog manually, or reject (not a catalog item). Confirming learns. Admin+manager only.

import { useState } from "react";
import {
  candidatesForVendorLine, searchCanonical, confirmVendorMatch, rejectVendorMatch,
  type QueueRow, type Candidate,
} from "../lib/market-reconcile-actions";

const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

function Card({ r, onDone }: { r: QueueRow; onDone: (id: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: number; name: string; size: string | null }>>([]);
  const [err, setErr] = useState<string | null>(null);

  async function confirm(canonicalId: number) {
    setBusy(true); setErr(null);
    const res = await confirmVendorMatch(r.id, canonicalId);
    if (res.ok) onDone(r.id); else { setErr(res.error); setBusy(false); }
  }
  async function reject() {
    setBusy(true); setErr(null);
    const res = await rejectVendorMatch(r.id);
    if (res.ok) onDone(r.id); else { setErr(res.error); setBusy(false); }
  }
  async function loadCands() { setCands([]); setCands(await candidatesForVendorLine(r.id)); }
  async function doSearch(v: string) { setQ(v); if (v.trim().length < 2) { setHits([]); return; } setHits(await searchCanonical(v)); }

  return (
    <li className={`rounded-2xl border border-neutral-200 bg-white p-3 ${busy ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-neutral-900"><span className="font-medium">{r.distributor}</span> · {r.vendor_description}</span>
        <span className="font-mono text-xs text-neutral-500">{money(r.unit_price_cents)}{r.uom ? `/${r.uom}` : ""}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {r.proposed_name ? (
          <button type="button" onClick={() => confirm(r.proposed_id as number)} disabled={busy}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
            ✓ Confirm: {r.proposed_name}{r.match_sim != null ? ` (${r.match_sim.toFixed(1)})` : ""}
          </button>
        ) : (
          <span className="text-xs text-neutral-400">no auto-match</span>
        )}
        <button type="button" onClick={loadCands} disabled={busy} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50">Other candidates</button>
        <input type="search" value={q} onChange={(e) => doSearch(e.target.value)} placeholder="search catalog…"
          className="w-48 rounded-md border border-neutral-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <button type="button" onClick={reject} disabled={busy} className="ml-auto rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-50">Not in catalog</button>
      </div>

      {cands && cands.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cands.map((c) => (
            <button key={c.id} type="button" onClick={() => confirm(c.id)} disabled={busy}
              className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-800 hover:bg-brand-100">
              {c.name} <span className="text-[10px] text-neutral-500">{c.size_ok ? "·size" : ""}{c.mat_ok ? "·mat" : ""}{c.type_ok ? "·type" : ""} {c.score.toFixed(1)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {q.trim().length >= 2 && hits.length > 0 ? (
        <ul className="mt-2 max-h-48 overflow-auto rounded-md border border-neutral-200">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => confirm(h.id)} disabled={busy} className="w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50">
                {h.name}{h.size ? <span className="text-xs text-neutral-400"> · {h.size}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {err ? <p className="mt-1 text-xs text-red-600">{err}</p> : null}
    </li>
  );
}

export function MarketReconcileQueue({ initialRows }: { initialRows: QueueRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [done, setDone] = useState(0);
  const remove = (id: number) => { setRows((p) => p.filter((r) => r.id !== id)); setDone((d) => d + 1); };
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        <span className="font-semibold text-neutral-900">{rows.length}</span> vendor lines awaiting review (matcher ranks by size + material + type).
        Confirm to lock the mapping in your in-house language — identical descriptions auto-resolve after.
        {done ? <span className="ml-2 text-emerald-700">· {done} reconciled this session.</span> : null}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">Queue clear. 🎉</p>
      ) : (
        <ul className="space-y-2">{rows.map((r) => <Card key={r.id} r={r} onDone={remove} />)}</ul>
      )}
    </div>
  );
}
