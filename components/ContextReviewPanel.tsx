"use client";

import { useState } from "react";
import { reviewContext, type ProposedContext } from "@/lib/context-review-actions";

const LABELS: Record<string, string> = {
  A_relationship_source: "Relationship & Source",
  B_property_household: "Property & Household",
  C_decision_dynamics: "People & Decision Dynamics",
  E_job_history_reality: "Job History & Reality",
  F_handling_guidance: "Handling Guidance",
};

export function ContextReviewPanel({ items }: { items: ProposedContext[] }) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, decision: "confirmed" | "rejected") {
    setBusy(id);
    const r = await reviewContext(id, decision);
    if (r.ok) setRows((rs) => rs.filter((x) => x.id !== id));
    setBusy(null);
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm text-neutral-500">
        No proposed context to review. New entries appear here as conversations are recorded + extracted on-prem.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-neutral-500">
            <span className="rounded bg-neutral-100 px-1.5 py-0.5">{LABELS[r.category] ?? r.category}</span>
            {r.confidence != null ? <span>conf {Math.round(r.confidence * 100)}%</span> : null}
            {r.hcp_customer_id ? <span>· {r.hcp_customer_id}</span> : <span className="text-amber-600">· unlinked</span>}
          </div>
          <p className="mt-1.5 text-sm text-neutral-800">{r.note}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => act(r.id, "confirmed")}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => act(r.id, "rejected")}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
