"use client";

// Stage D of the scheduling advisor: work the "needs scheduling" backlog on
// /dispatch. For each unscheduled job, recommend a tech + time (for a chosen
// candidate date). Advisory only — these are existing HCP jobs, so the panel
// informs the dispatcher; she opens the job to actually schedule it.

import { useState } from "react";
import Link from "next/link";

type BacklogJob = { hcp_job_id: string; customer_name: string; city: string; street: string; notes_preview: string; age_days: number | null };
type AdvisorRec = { tech_short_name: string; suggested_start_chi: string; fit_score: number; why: string; concerns?: string };
type AdvisorResult =
  | { ok: true; recommendations: AdvisorRec[]; overall_note: string; unschedulable_reason?: string; elapsed_ms?: number }
  | { ok: false; error: string };
type AdvisorJobInput = { description: string; customer_id?: string; customer_name?: string; address?: string; city?: string; date_chi: string; duration_min?: number };

type RowState = { loading: boolean; date: string; recs?: AdvisorRec[]; note?: string; unsched?: string; error?: string };

export function AdvisorBacklogPanel({ jobs, recommend }: { jobs: BacklogJob[]; recommend: (job: AdvisorJobInput) => Promise<AdvisorResult> }) {
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [rows, setRows] = useState<Record<string, RowState>>({});

  function st(id: string): RowState { return rows[id] ?? { loading: false, date: tomorrow }; }
  function set(id: string, patch: Partial<RowState>) { setRows((s) => ({ ...s, [id]: { ...st(id), ...patch } })); }

  async function go(j: BacklogJob) {
    const date = st(j.hcp_job_id).date;
    set(j.hcp_job_id, { loading: true, error: undefined, recs: undefined, note: undefined, unsched: undefined });
    try {
      const r = await recommend({
        description: j.notes_preview?.trim() || `Scheduling visit for ${j.customer_name}${j.city ? ` in ${j.city}` : ""}`,
        customer_name: j.customer_name,
        address: j.street || undefined,
        city: j.city || undefined,
        date_chi: date,
      });
      if (r.ok) set(j.hcp_job_id, { loading: false, recs: r.recommendations, note: r.overall_note, unsched: r.unschedulable_reason });
      else set(j.hcp_job_id, { loading: false, error: r.error });
    } catch (e) {
      set(j.hcp_job_id, { loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <details open className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-brand-900">
        ✨ Advisor — work the backlog
        <span className="ml-2 font-normal text-brand-900/70">recommend a tech + time for each unscheduled job</span>
      </summary>
      <ul className="mt-3 h-96 space-y-2 overflow-y-auto pr-1">
        {jobs.map((j) => {
          const s = st(j.hcp_job_id);
          return (
            <li key={j.hcp_job_id} className="rounded-lg border border-neutral-200 bg-white p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-neutral-900">{j.customer_name}</span>
                {j.city ? <span className="text-xs text-neutral-500">{j.city}</span> : null}
                {j.age_days != null ? <span className="text-xs text-neutral-400">· {j.age_days}d old</span> : null}
                <Link href={`/job/${j.hcp_job_id}`} className="font-mono text-[10px] text-brand-700 hover:underline">{j.hcp_job_id.slice(0, 12)}…</Link>
                <span className="ml-auto flex items-center gap-2">
                  <input
                    type="date"
                    value={s.date}
                    onChange={(e) => set(j.hcp_job_id, { date: e.target.value })}
                    className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => go(j)}
                    disabled={s.loading}
                    className="rounded-md border border-brand-300 bg-white px-2.5 py-0.5 text-xs font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"
                  >
                    {s.loading ? "Thinking…" : "Recommend"}
                  </button>
                </span>
              </div>
              {j.notes_preview ? <div className="mt-1 text-xs italic text-neutral-500">“{j.notes_preview}”</div> : null}
              {s.error ? <div className="mt-1 text-xs text-red-700">Advisor unavailable: {s.error}</div> : null}
              {s.note ? <div className="mt-1 text-xs text-neutral-700">{s.note}</div> : null}
              {s.unsched ? <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{s.unsched}</div> : null}
              {s.recs && s.recs.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {s.recs.map((r, i) => (
                    <li key={i} className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs">
                      <span className="font-medium text-neutral-900">{r.tech_short_name}{r.suggested_start_chi ? ` · ${r.suggested_start_chi}` : ""}</span>
                      <span className="ml-1 text-neutral-400">({Math.round((r.fit_score ?? 0) * 100)}%)</span>
                      <span className="ml-1 text-neutral-700">— {r.why}</span>
                      {r.concerns ? <span className="ml-1 text-amber-700">⚠ {r.concerns}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 text-[10px] text-neutral-400">Recommendations only. Open the job to schedule it in HCP.</div>
    </details>
  );
}
