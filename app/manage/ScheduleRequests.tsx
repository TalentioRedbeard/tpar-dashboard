"use client";

// B2: wrap-sourced schedule requests ("need off Friday by 4:30") with one-tap
// Ack / Decline. Auto-created by tech-wrap-distill, assigned to the scheduler;
// this is their ONLY surface (wraps live on /conversation, which is
// admin-allowlist gated — Madisson can't see it). Visible age keeps them from
// rotting; decline requires a why.

import { useState, useTransition } from "react";
import { decideScheduleRequest } from "./schedule-request-actions";

export type ScheduleRequestRow = {
  id: string;
  title: string;
  detail: string | null;
  assignedTo: string | null;
  createdAt: string;
  ageDays: number;
};

export function ScheduleRequests({ rows }: { rows: ScheduleRequestRow[] }) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, "ack" | "decline">>({});

  if (rows.length === 0) return null;

  function decide(id: string, decision: "ack" | "decline") {
    setErr(null);
    setBusyId(id);
    start(async () => {
      const r = await decideScheduleRequest({ taskId: id, decision, ...(decision === "decline" ? { note } : {}) });
      setBusyId(null);
      if (r.ok) {
        setDecided((p) => ({ ...p, [id]: decision }));
        setDeclining(null);
        setNote("");
      } else {
        setErr(r.error);
      }
    });
  }

  const live = rows.filter((r) => !decided[r.id]);

  return (
    <section className="mb-6 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
      <h2 className="text-sm font-semibold text-neutral-900">
        🗓️ Schedule requests <span className="font-normal text-neutral-500">— from daily wraps; the tech hears back from you</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-neutral-900">{r.title}</div>
                {r.detail ? <div className="mt-0.5 whitespace-pre-line text-xs text-neutral-600">{r.detail.split("\n\nFrom ")[0]}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`text-[11px] font-medium ${r.ageDays >= 2 ? "text-red-700" : r.ageDays >= 1 ? "text-amber-700" : "text-neutral-400"}`}>
                  {r.ageDays === 0 ? "today" : `${r.ageDays}d old`}
                </span>
                {decided[r.id] ? (
                  <span className={`rounded-md px-2 py-1 text-xs font-medium ${decided[r.id] === "ack" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>
                    {decided[r.id] === "ack" ? "Acked ✓ — tell the tech" : "Declined — tell the tech why"}
                  </span>
                ) : declining === r.id ? null : (
                  <>
                    <button
                      type="button"
                      disabled={pending && busyId === r.id}
                      onClick={() => decide(r.id, "ack")}
                      className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {pending && busyId === r.id ? "…" : "✓ Ack"}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => { setDeclining(r.id); setNote(""); setErr(null); }}
                      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                    >
                      Decline
                    </button>
                  </>
                )}
              </div>
            </div>
            {declining === r.id && !decided[r.id] ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="why? (required — the tech hears this back)"
                  className="min-w-[240px] flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={pending || !note.trim()}
                  onClick={() => decide(r.id, "decline")}
                  className="rounded-md bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-900 disabled:opacity-40"
                >
                  Decline it
                </button>
                <button type="button" onClick={() => setDeclining(null)} className="text-xs text-neutral-500 hover:underline">cancel</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {err ? <p className="mt-2 text-xs text-red-700">{err}</p> : null}
      {live.length === 0 ? <p className="mt-2 text-xs text-neutral-500">All decided — close the loop with the techs directly.</p> : null}
    </section>
  );
}
