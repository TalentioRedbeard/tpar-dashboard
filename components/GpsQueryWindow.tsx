"use client";

// "Past GPS data" window on /dispatch (Danny 2026-05-31). Free-text NL queries
// over historical fleet GPS + trip data, answered by the gps-query edge fn and
// rendered with the shared AskResult (text/table/map/synthesis). The action +
// edge fn both gate to dispatch roles, so this is Madisson/owner only.

import { useState, useTransition, type FormEvent } from "react";
import { gpsQuery, type GpsQueryResult } from "../app/dispatch/gps-action";
import { runEndpointResearch } from "../lib/gps-research-actions";
import { AskResult } from "./AskResult";

const EXAMPLES = [
  "How many parts runs did Omar make last week?",
  "Did anyone drive a van home this week?",
  "Where are the vans right now?",
  "Gas stops by vehicle this month",
  "Who arrived late yesterday?",
];

export function GpsQueryWindow({ canResearch = false }: { canResearch?: boolean }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<GpsQueryResult | null>(null);
  const [pending, start] = useTransition();
  const [research, setResearch] = useState<string | null>(null);
  const [researching, startResearch] = useTransition();

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
      <p className="mb-2 text-xs text-neutral-500">Ask about trips, mileage, idle, arrivals, where the fleet went — incl. parts runs, gas, and vans driven home.</p>
      {canResearch ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <button
            type="button"
            disabled={researching}
            onClick={() => startResearch(async () => {
              const r = await runEndpointResearch();
              if (!r.ok) { setResearch(`⚠ ${r.error}`); return; }
              const cats = Object.entries(r.by_category ?? {}).map(([k, v]) => `${v} ${k}`).join(", ");
              setResearch(`researched ${r.researched ?? 0}${cats ? ` (${cats})` : ""} · ${r.note === "done" ? "✓ done" : `${r.remaining ?? 0} left — run again`}`);
            })}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            title="Look up unidentified van stops (parts/gas/food/home) via Google Places"
          >
            {researching ? "Researching…" : "⚙ Research van stops"}
          </button>
          <span className="text-[11px] text-amber-800">One-time backfill — identifies parts/gas/food/home stops, then it&apos;s cached. Run again until it says &quot;done.&quot;</span>
          {research ? <span className="text-[11px] font-medium text-neutral-700">{research}</span> : null}
        </div>
      ) : null}
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
