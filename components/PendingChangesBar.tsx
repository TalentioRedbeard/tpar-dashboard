"use client";

// Pending schedule-change proposals (#21) — a review strip at the top of /schedule.
// Each queued reschedule/reassign shows the proposed slot + tech. Admin/managers
// can dismiss; the OWNER can "Apply → HCP" (Phase 1 gate), which pushes the change
// to the real job via update-hcp-job and then bounces the schedule back.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissChangeRequest, applyChangeRequest, type PendingChange } from "../lib/schedule-changes";
import { ScrollPanel } from "./ui/ScrollPanel";

function fmt12(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ap}`;
}

export function PendingChangesBar({ changes, canApply = false }: { changes: PendingChange[]; canApply?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (changes.length === 0) return null;

  function apply(c: PendingChange) {
    const what = c.kind === "reassign" ? `reassign to ${c.proposed_tech ?? "?"}` : `move to ${c.proposed_date}${c.proposed_start_time ? " · " + fmt12(c.proposed_start_time) : ""}`;
    if (!window.confirm(`Apply to HCP — ${c.customer_name ?? c.hcp_job_id}: ${what}?\n\nThis updates the real job in Housecall Pro. HCP decides whether the customer is notified.`)) return;
    start(async () => {
      const r = await applyChangeRequest(c.id);
      if (!r.ok) { setErrors((e) => ({ ...e, [c.id]: r.error ?? "apply failed" })); return; }
      setErrors((e) => { const n = { ...e }; delete n[c.id]; return n; });
      router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <div className="mb-1.5 text-sm font-semibold text-amber-900">⏳ Proposed schedule changes · {changes.length}</div>
      <ScrollPanel tier="secondary">
      <ul className="space-y-1">
        {changes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
            <span className="font-medium">{c.customer_name ?? c.hcp_job_id ?? "—"}</span>
            <span className="text-amber-800/80">→ {c.proposed_date}{c.proposed_start_time ? ` · ${fmt12(c.proposed_start_time)}` : ""}{c.proposed_tech ? ` · ${c.proposed_tech}` : ""}</span>
            <span className="rounded-sm bg-amber-200/70 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-800">{c.kind}</span>
            {c.requested_by ? <span className="text-[10px] text-amber-700/70">by {c.requested_by}</span> : null}
            {canApply ? (
              <button type="button" disabled={pending} onClick={() => apply(c)} className="ml-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Apply → HCP</button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => start(async () => { await dismissChangeRequest(c.id); router.refresh(); })} className="text-[11px] text-amber-600 hover:text-red-600">dismiss</button>
            {errors[c.id] ? <span className="w-full text-[10px] text-red-600">⚠ {errors[c.id]}</span> : null}
          </li>
        ))}
      </ul>
      </ScrollPanel>
      <div className="mt-1 text-[10px] text-amber-700/80">
        {canApply ? "Apply pushes the change to the real HCP job. Whether the customer is notified follows HCP's default. Each apply is logged." : "Queued proposals — not yet pushed to HCP."}
      </div>
    </div>
  );
}
