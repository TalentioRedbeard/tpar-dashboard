"use client";

// Suggested-triage panel on /dispatch (Danny 2026-05-31). On demand, reads each
// needs-scheduling item's recent customer comms and proposes a disposition +
// reason + next step. The dispatcher reviews and Applies (writes the same
// dispatch_acks the manual buttons use) or Dismisses — nothing auto-changes, so
// no work gets dropped.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { suggestTriage, applyTriageDisposition, type TriageProposal, type TriageItemInput } from "../lib/dispatch-triage";
import { DISPOSITION_LABEL, dispositionChip, type DispatchAckStatus } from "../app/dispatch/dispositions";

type TriageItem = { id: string; customer_id: string | null; customer_name: string; age_days: number | null; context: string | null };

export function TriagePanel({ items }: { items: TriageItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [proposals, setProposals] = useState<TriageProposal[] | null>(null);
  const [handled, setHandled] = useState<Record<string, "applied" | "dismissed">>({});
  const [err, setErr] = useState<string | null>(null);

  const byId = new Map(items.map((i) => [i.id, i]));

  function run() {
    setErr(null);
    start(async () => {
      const input: TriageItemInput[] = items.map((i) => ({ id: i.id, item_type: "needs_scheduling", customer_id: i.customer_id, customer_name: i.customer_name, current_status: null, age_days: i.age_days, context: i.context }));
      const r = await suggestTriage(input);
      if (r.ok) { setProposals(r.proposals); setHandled({}); } else setErr(r.error);
    });
  }

  function apply(p: TriageProposal) {
    start(async () => {
      const note = `${p.reason}${p.next_step ? ` · next: ${p.next_step}` : ""}`.slice(0, 500);
      const r = await applyTriageDisposition("needs_scheduling", p.id, p.proposed_status, note);
      if (r.ok) { setHandled((s) => ({ ...s, [p.id]: "applied" })); router.refresh(); } else setErr(r.error || "apply failed");
    });
  }
  function dismiss(id: string) { setHandled((s) => ({ ...s, [id]: "dismissed" })); }

  const actionable = (proposals ?? []).filter((p) => p.proposed_status !== "no_change" && !handled[p.id]);
  const noChangeCount = (proposals ?? []).filter((p) => p.proposed_status === "no_change").length;
  const appliedCount = Object.values(handled).filter((v) => v === "applied").length;

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-violet-900">✨ Suggested triage</h3>
        <button type="button" onClick={run} disabled={pending || items.length === 0} className="rounded-md bg-violet-700 px-3 py-1 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50">
          {pending ? "Reading comms…" : proposals ? "Re-run" : `Suggest updates · ${items.length}`}
        </button>
      </div>
      <p className="mb-2 text-[11px] text-violet-900/70">Reviews recent customer comms and proposes a status for each needs-scheduling item. Nothing changes until you Apply.</p>
      {err ? <div className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">{err}</div> : null}
      {proposals === null ? null : actionable.length === 0 ? (
        <div className="text-sm text-violet-900/60">{appliedCount ? `${appliedCount} applied. ` : ""}No further changes suggested{noChangeCount ? ` (${noChangeCount} look unchanged)` : ""}.</div>
      ) : (
        <ul className="space-y-2">
          {actionable.map((p) => {
            const it = byId.get(p.id);
            return (
              <li key={p.id} className="rounded-xl border border-violet-200 bg-white p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-900">{it?.customer_name ?? p.id}</span>
                  {it?.age_days != null ? <span className="text-xs text-neutral-400">{it.age_days}d old</span> : null}
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${dispositionChip(p.proposed_status as DispatchAckStatus)}`}>{DISPOSITION_LABEL[p.proposed_status as DispatchAckStatus] ?? p.proposed_status}</span>
                  <span className="text-[10px] uppercase text-neutral-400">{p.confidence}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <button type="button" onClick={() => apply(p)} disabled={pending} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">Apply</button>
                    <button type="button" onClick={() => dismiss(p.id)} disabled={pending} className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50">Dismiss</button>
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-700">{p.reason}</div>
                {p.next_step ? <div className="mt-0.5 text-xs text-violet-800">→ {p.next_step}</div> : null}
              </li>
            );
          })}
        </ul>
      )}
      {appliedCount > 0 && actionable.length > 0 ? <div className="mt-2 text-[11px] text-emerald-700">Applied items collapse from the needs-scheduling list on refresh.</div> : null}
    </div>
  );
}
