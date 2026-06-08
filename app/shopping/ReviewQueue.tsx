"use client";

import { useState, useTransition } from "react";
import { confirmCandidate, rejectCandidate, createItemFromCandidate, renameItem, type ReviewCandidate } from "./review-queue-actions";

type Initial = { items: ReviewCandidate[]; proposable: number; noMatch: number; total: number };

export function ReviewQueue({ initial }: { initial: Initial }) {
  const [items, setItems] = useState(initial.items);
  const [busy, setBusy] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [, start] = useTransition();

  const act = (id: number, fn: (id: number) => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    start(async () => {
      const r = await fn(id);
      if (r.ok) setItems((xs) => xs.filter((x) => x.id !== id));
      setBusy(null);
    });
  };

  const saveName = (c: ReviewCandidate) => {
    const name = draft.trim();
    if (!c.proposed_item_id || !name) { setEditId(null); return; }
    setBusy(c.id);
    start(async () => {
      const r = await renameItem(c.proposed_item_id!, name);
      if (r.ok) setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, proposed_item_name: r.name ?? name } : x)));
      setEditId(null);
      setBusy(null);
    });
  };

  return (
    <div>
      <div className="mb-3 text-sm text-neutral-500">
        {initial.total} to review · <span className="text-emerald-700">{initial.proposable} proposed links</span> · {initial.noMatch} possible new parts.
        Each confirm is permanent — the matcher never asks again.
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">Queue clear 🎉</p>
      ) : (
        <ul className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
          {items.map((c) => (
            <li key={c.id} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                {c.distributor_name ? (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">{c.distributor_name}</span>
                ) : null}
                <span>seen {c.times_seen}×</span>
              </div>
              <div className="mt-1 text-sm font-medium text-neutral-900">{c.vendor_description}</div>
              {c.proposed_item_name ? (
                <div className="mt-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[13px] text-emerald-900">
                  {editId === c.id ? (
                    <div className="flex items-center gap-1.5">
                      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveName(c); if (e.key === "Escape") setEditId(null); }}
                        className="flex-1 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[13px] text-emerald-950" />
                      <button type="button" onClick={() => saveName(c)} disabled={busy === c.id}
                        className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50">Save</button>
                      <button type="button" onClick={() => setEditId(null)} className="px-1 text-xs text-emerald-700/70 hover:text-emerald-900">Cancel</button>
                    </div>
                  ) : (
                    <>
                      looks like <span className="font-semibold">{c.proposed_item_name}</span>
                      {c.proposed_item_category ? <span className="text-emerald-700/70"> · {c.proposed_item_category}</span> : null}
                      {c.match_confidence != null ? <span className="ml-1 text-emerald-700/60">({Math.round(c.match_confidence * 100)}%)</span> : null}
                      <button type="button" onClick={() => { setEditId(c.id); setDraft(c.proposed_item_name ?? ""); }}
                        title="Fix this part's name" className="ml-1.5 text-emerald-700/60 hover:text-emerald-900">✎ edit</button>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-1.5 text-[13px] text-neutral-500">No catalog match — looks like a new part.</div>
              )}
              <div className="mt-2 flex items-center gap-2">
                {c.proposed_item_id ? (
                  <button type="button" disabled={busy === c.id} onClick={() => act(c.id, confirmCandidate)}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
                    ✓ Confirm
                  </button>
                ) : (
                  <button type="button" disabled={busy === c.id} onClick={() => act(c.id, createItemFromCandidate)}
                    className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
                    + Add as new part
                  </button>
                )}
                <button type="button" disabled={busy === c.id} onClick={() => act(c.id, rejectCandidate)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
                  ✗ {c.proposed_item_id ? "Not a match" : "Ignore"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
