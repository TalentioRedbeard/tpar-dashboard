"use client";

// Time-off approval queue (Danny 2026-07-17) — the office Acks/Declines time-off
// requests submitted from the schedule (any role). On approve, the day shows an
// "Off — Name" band on the board. Decline requires a why. Mirrors the wrap
// schedule-requests panel; sits alongside it on /manage.

import { useState, useTransition } from "react";
import { decideTimeOff, type TimeOffRow } from "@/lib/time-off-actions";

function fmt(d: string): string {
  // "2026-07-25" -> "Fri 7/25"
  const dt = new Date(`${d}T12:00:00-05:00`);
  return dt.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "numeric", day: "numeric" });
}

export function TimeOffApprovals({ rows }: { rows: TimeOffRow[] }) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, "approve" | "decline">>({});

  if (rows.length === 0) return null;

  function decide(id: string, decision: "approve" | "decline") {
    setErr(null);
    setBusyId(id);
    start(async () => {
      const r = await decideTimeOff({ id, decision, ...(decision === "decline" ? { note } : {}) });
      setBusyId(null);
      if (r.ok) {
        setDecided((p) => ({ ...p, [id]: decision }));
        setDeclining(null);
        setNote("");
      } else {
        setErr(r.error ?? "failed");
      }
    });
  }

  return (
    <section className="mb-6 rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
      <h2 className="text-sm font-semibold text-neutral-900">
        🏖️ Time-off requests <span className="font-normal text-neutral-500">— from the schedule; approve blocks the day on the board</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const name = r.tech_short_name || r.tech_full_name;
          const range = r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} → ${fmt(r.end_date)}`;
          return (
            <li key={r.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-900">
                    {name} <span className="font-normal text-neutral-500">off</span> {range}
                    {r.requested_role && r.requested_role !== "tech" ? (
                      <span className="ml-1.5 rounded bg-neutral-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">{r.requested_role}</span>
                    ) : null}
                  </div>
                  {r.reason ? <div className="mt-0.5 text-xs text-neutral-600">{r.reason}</div> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {decided[r.id] ? (
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ${decided[r.id] === "approve" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>
                      {decided[r.id] === "approve" ? "Approved ✓ — on the board" : "Declined — tell them why"}
                    </span>
                  ) : declining === r.id ? null : (
                    <>
                      <button
                        type="button"
                        disabled={pending && busyId === r.id}
                        onClick={() => decide(r.id, "approve")}
                        className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {pending && busyId === r.id ? "…" : "✓ Approve"}
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
                    placeholder="why? (required — they hear this back)"
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
          );
        })}
      </ul>
      {err ? <p className="mt-2 text-xs text-red-700">{err}</p> : null}
    </section>
  );
}
