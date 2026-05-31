"use client";

// "Past GPS data" window on /dispatch (Danny 2026-05-31). Free-text NL queries
// over historical fleet GPS + trip data, answered by the gps-query edge fn and
// rendered with the shared AskResult (text/table/map/synthesis). The action +
// edge fn both gate to dispatch roles, so this is Madisson/owner only.

import { useState, useTransition, type FormEvent } from "react";
import { gpsQuery, type GpsQueryResult } from "../app/dispatch/gps-action";
import { AskResult } from "./AskResult";

const EXAMPLES = [
  "How many miles did Omar drive last week?",
  "Where are the vans right now?",
  "Who arrived late yesterday?",
  "Idle time per vehicle this month",
  "Trips for the F-350 on 5/29",
];

export function GpsQueryWindow() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<GpsQueryResult | null>(null);
  const [pending, start] = useTransition();

  function run(question: string) {
    const v = question.trim();
    if (!v || pending) return;
    setQ(v);
    start(async () => setResult(await gpsQuery({ question: v })));
  }
  function submit(e: FormEvent) { e.preventDefault(); run(q); }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-900">📍 Past GPS data</h3>
      <p className="mb-2 text-xs text-neutral-500">Ask about vehicle trips, mileage, idle time, arrivals, or where the fleet has been.</p>
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. where was the E-350 yesterday afternoon"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button type="submit" disabled={pending || !q.trim()} className="shrink-0 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => run(ex)} disabled={pending} className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50">{ex}</button>
        ))}
      </div>
      {pending ? (
        <div className="mt-3 text-sm text-neutral-500">Thinking…</div>
      ) : result ? (
        <div className="mt-3">
          {result.ok && result.plan ? (
            <AskResult plan={result.plan} rows={result.rows ?? []} sqlError={result.sql_error ?? null} scope={result.scope ?? null} />
          ) : (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{result.error ?? "Couldn't get an answer."}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
