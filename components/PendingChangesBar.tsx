"use client";

// Pending schedule-change proposals (#21) — a review strip at the top of /schedule.
// Each queued reschedule shows the proposed slot + a dismiss; nothing is on HCP yet.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissChangeRequest, type PendingChange } from "../lib/schedule-changes";

function fmt12(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ap}`;
}

export function PendingChangesBar({ changes }: { changes: PendingChange[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (changes.length === 0) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <div className="mb-1.5 text-sm font-semibold text-amber-900">⏳ Proposed schedule changes · {changes.length}</div>
      <ul className="space-y-1">
        {changes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
            <span className="font-medium">{c.customer_name ?? c.hcp_job_id ?? "—"}</span>
            <span className="text-amber-800/80">→ {c.proposed_date}{c.proposed_start_time ? ` · ${fmt12(c.proposed_start_time)}` : ""}{c.proposed_tech ? ` · ${c.proposed_tech}` : ""}</span>
            {c.requested_by ? <span className="text-[10px] text-amber-700/70">by {c.requested_by}</span> : null}
            <button type="button" disabled={pending} onClick={() => start(async () => { await dismissChangeRequest(c.id); router.refresh(); })} className="ml-1 text-[11px] text-amber-600 hover:text-red-600">dismiss</button>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-[10px] text-amber-700/80">Queued proposals — not yet pushed to HCP (write path pending).</div>
    </div>
  );
}
