"use client";

// Drag-to-reorder the schedule's tech rows (#21). A "⇅ Reorder rows" toggle opens
// a draggable list of the active techs; drag to set the vertical order, Save to
// persist (per-dispatcher). The grid re-renders in that order.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTechOrder, resetTechOrder } from "../lib/schedule-order";

type T = { full: string; short: string };

export function TechOrderControl({ techs }: { techs: T[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<T[]>(techs);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [pending, start] = useTransition();

  function drop(idx: number) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    setOrder((o) => {
      const next = [...o];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setOverIdx(null);
  }

  function save() {
    start(async () => { await saveTechOrder(order.map((t) => t.full)); setOpen(false); router.refresh(); });
  }
  function reset() {
    start(async () => { await resetTechOrder(); setOpen(false); router.refresh(); });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100">
        ⇅ Reorder rows
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-neutral-700">Drag techs into your preferred order</div>
      <ul className="mb-2 space-y-1">
        {order.map((t, i) => (
          <li
            key={t.full}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
            onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
            onDrop={() => drop(i)}
            className={`flex cursor-grab items-center gap-2 rounded-md border px-2 py-1 text-sm active:cursor-grabbing ${overIdx === i && dragIdx !== i ? "border-brand-400 bg-brand-50" : "border-neutral-200 bg-neutral-50"}`}
          >
            <span className="text-neutral-400">⋮⋮</span>
            <span className="text-xs text-neutral-400">{i + 1}.</span>
            <span className="font-medium text-neutral-900">{t.short}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "…" : "Save order"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:underline">Cancel</button>
        <button type="button" onClick={reset} disabled={pending} className="ml-auto text-xs text-neutral-400 hover:text-neutral-700">Reset to default</button>
      </div>
    </div>
  );
}
