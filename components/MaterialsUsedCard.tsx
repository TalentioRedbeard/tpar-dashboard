"use client";

// Materials USED on the job (Danny 2026-06-15) — what got installed, for costing +
// restock. Distinct from "Procurement needs". Techs add items with catalog typeahead
// (or a custom name). Cost shown in dollars; stored as a cents snapshot.

import { useState, useRef, useTransition } from "react";
import {
  addMaterialUsed, voidMaterialUsed, searchInvItems,
  type MaterialUsed, type CatalogItem,
} from "../lib/materials-actions";

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MaterialsUsedCard({
  hcpJobId,
  materials,
  canWrite,
}: {
  hcpJobId: string;
  materials: MaterialUsed[];
  canWrite: boolean;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [uom, setUom] = useState("");
  const [invItemId, setInvItemId] = useState<number | null>(null);
  const [costCents, setCostCents] = useState<number | null>(null);
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = materials.reduce((sum, m) => sum + (m.unit_cost_cents ?? 0) * (Number(m.qty) || 0), 0);

  function onNameChange(v: string) {
    setName(v);
    setInvItemId(null); // typing a custom name detaches the catalog link
    setCostCents(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (v.trim().length < 2) { setResults([]); setShowResults(false); return; }
    debounce.current = setTimeout(() => {
      startTransition(async () => {
        const r = await searchInvItems(v);
        setResults(r);
        setShowResults(r.length > 0);
      });
    }, 250);
  }

  function pick(item: CatalogItem) {
    setName(item.name);
    setUom(item.uom ?? "");
    setInvItemId(item.id);
    setCostCents(item.cost_cents);
    setShowResults(false);
  }

  function submit() {
    setError(null);
    if (!name.trim()) { setError("Add an item name."); return; }
    startTransition(async () => {
      const r = await addMaterialUsed({
        hcp_job_id: hcpJobId,
        item_name: name,
        qty: Number(qty) || 1,
        uom: uom || null,
        inv_item_id: invItemId,
        unit_cost_cents: costCents,
      });
      if (!r.ok) { setError(r.error); return; }
      setName(""); setQty("1"); setUom(""); setInvItemId(null); setCostCents(null); setResults([]);
    });
  }

  function remove(id: string) {
    startTransition(async () => { await voidMaterialUsed({ id, hcp_job_id: hcpJobId }); });
  }

  return (
    <div className="space-y-3">
      {materials.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-500">
          No materials logged for this job yet. Add what you installed/used as you go — it feeds job costing and restock.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                <th className="px-3 py-2 text-right font-medium">Line</th>
                <th className="px-3 py-2 text-left font-medium">By</th>
                {canWrite ? <th className="px-2 py-2"></th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {materials.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-neutral-900">
                    {m.item_name}
                    {!m.inv_item_id ? <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-600">custom</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-700">{Number(m.qty)}{m.uom ? ` ${m.uom}` : ""}</td>
                  <td className="px-3 py-2 text-right text-neutral-700">{fmtCents(m.unit_cost_cents)}</td>
                  <td className="px-3 py-2 text-right text-neutral-900">{m.unit_cost_cents != null ? fmtCents(m.unit_cost_cents * (Number(m.qty) || 0)) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{m.added_by ?? "—"}</td>
                  {canWrite ? (
                    <td className="px-2 py-2 text-right">
                      <button type="button" onClick={() => remove(m.id)} disabled={isPending}
                        className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-50" title="Remove">×</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-neutral-200 bg-neutral-50 text-sm">
              <tr>
                <td className="px-3 py-2 font-medium text-neutral-700" colSpan={3}>Total materials cost</td>
                <td className="px-3 py-2 text-right font-semibold text-neutral-900">{fmtCents(total)}</td>
                <td colSpan={canWrite ? 2 : 1}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canWrite ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">Item (search catalog or type custom)</label>
              <input
                type="text" value={name}
                onChange={(e) => onNameChange(e.target.value)}
                onFocus={() => { if (results.length > 0) setShowResults(true); }}
                placeholder="e.g., 1/2 in copper coupling"
                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {showResults && results.length > 0 ? (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg">
                  {results.map((it) => (
                    <li key={it.id}>
                      <button type="button" onClick={() => pick(it)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50">
                        <span className="text-neutral-800">{it.name}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{it.uom ?? ""} {it.cost_cents != null ? fmtCents(it.cost_cents) : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="w-16">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">Qty</label>
              <input type="text" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                className="block w-full rounded-md border border-neutral-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="w-20">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">Unit</label>
              <input type="text" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="ea"
                className="block w-full rounded-md border border-neutral-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <button type="button" onClick={submit} disabled={isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {isPending ? "Adding…" : "+ Add"}
            </button>
          </div>
          {costCents != null ? <p className="mt-1.5 text-[11px] text-neutral-500">⚡ from catalog · unit cost {fmtCents(costCents)}{uom ? ` / ${uom}` : ""}</p> : null}
          {error ? <p className="mt-1.5 text-xs text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
