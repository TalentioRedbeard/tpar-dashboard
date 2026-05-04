"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  confirmRecording, relinkRecording, unbindRecording,
  getCandidateJobsForRecording,
  type RecordingRow as Rec, type CandidateJob,
} from "./actions";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
}

function fmtDuration(sec: number | null): string {
  if (!sec) return "—";
  const seconds = Math.floor(sec / 1000); // seconds-as-ms based on observed data
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function methodColor(method: string | null, conf: number | null): string {
  const c = Number(conf ?? 0);
  if (c >= 1) return "bg-emerald-100 text-emerald-800";
  if (c >= 0.7) return "bg-amber-100 text-amber-800";
  if (c > 0)    return "bg-orange-100 text-orange-800";
  return "bg-neutral-100 text-neutral-700";
}

export function RecordingRow({ rec }: { rec: Rec }) {
  const [mode, setMode] = useState<"view" | "relink">("view");
  const [candidates, setCandidates] = useState<CandidateJob[] | null>(null);
  const [pickedJobId, setPickedJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadCandidates() {
    if (candidates) return;
    const list = await getCandidateJobsForRecording(rec.id);
    setCandidates(list);
  }

  return (
    <li className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-neutral-900">{rec.recording_name ?? "(unnamed)"}</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${methodColor(rec.match_method, rec.match_confidence)}`}>
              {rec.match_method ?? "?"}{rec.match_confidence != null ? ` · ${Number(rec.match_confidence).toFixed(2)}` : ""}
            </span>
            {rec.url_mp3 ? (
              <a href={rec.url_mp3} target="_blank" rel="noopener" className="text-xs text-brand-700 hover:underline">audio →</a>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            {fmtDate(rec.recorded_at)} · {fmtDuration(rec.duration_sec)}
            {rec.hcp_job_id ? (
              <> · bound to <Link href={`/job/${rec.hcp_job_id}`} className="font-mono text-brand-700 hover:underline">{rec.hcp_job_id.slice(0, 14)}…</Link></>
            ) : (
              <> · <span className="text-red-700 font-medium">unbound</span></>
            )}
          </div>
          {rec.scope_notes ? (
            <p className="mt-2 line-clamp-2 text-xs text-neutral-600 whitespace-pre-line">{rec.scope_notes}</p>
          ) : null}
        </div>

        {mode === "view" && (
          <div className="flex shrink-0 gap-1.5">
            {rec.hcp_job_id && Number(rec.match_confidence ?? 0) < 1 ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const r = await confirmRecording(rec.id);
                    if (!r.ok) setError(r.error ?? "failed");
                  });
                }}
                className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                ✓ Confirm
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setMode("relink");
                loadCandidates();
              }}
              className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200"
            >
              Re-link
            </button>
            {rec.hcp_job_id ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (!confirm("Unbind this recording? It'll show as unbound on /admin/salesask.")) return;
                  setError(null);
                  startTransition(async () => {
                    const r = await unbindRecording({ recording_id: rec.id });
                    if (!r.ok) setError(r.error ?? "failed");
                  });
                }}
                className="rounded-md bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-100 disabled:opacity-50"
              >
                Unbind
              </button>
            ) : null}
          </div>
        )}
      </div>

      {mode === "relink" && (
        <div className="mt-3 rounded-md bg-neutral-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Pick a job</span>
            <button
              type="button"
              onClick={() => { setMode("view"); setPickedJobId(""); }}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              cancel
            </button>
          </div>
          {candidates === null ? (
            <p className="text-xs text-neutral-500">Loading candidates…</p>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-neutral-500">No recent jobs for this lead-tech in ±14 days. Paste an hcp_job_id manually below.</p>
          ) : (
            <div className="mb-2 space-y-1 text-xs">
              {candidates.map((c) => (
                <button
                  key={c.hcp_job_id}
                  type="button"
                  onClick={() => setPickedJobId(c.hcp_job_id)}
                  className={
                    "block w-full rounded-md border px-3 py-2 text-left transition " +
                    (pickedJobId === c.hcp_job_id
                      ? "border-brand-500 bg-brand-50 shadow-sm"
                      : "border-neutral-200 bg-white hover:border-neutral-300")
                  }
                >
                  <span className="font-medium text-neutral-900">{c.customer_name ?? "(no name)"}</span>
                  <span className="ml-2 text-neutral-500">{c.job_date ?? "no date"}</span>
                  <span className="ml-2 text-neutral-400">· {c.tech_primary_name ?? "—"}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={pickedJobId}
              onChange={(e) => setPickedJobId(e.target.value)}
              placeholder="job_..."
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-xs font-mono"
            />
            <button
              type="button"
              disabled={!pickedJobId || isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const r = await relinkRecording({ recording_id: rec.id, hcp_job_id: pickedJobId });
                  if (r.ok) { setMode("view"); setPickedJobId(""); }
                  else setError(r.error ?? "failed");
                });
              }}
              className="rounded-md bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {isPending ? "Linking…" : "Re-link"}
            </button>
          </div>
        </div>
      )}

      {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}
    </li>
  );
}
