"use client";

// TriggerStageClock — per-trigger stage clock (Danny 7/17: "put that clock on
// each trigger button for data tracking"). A stage runs from its trigger's
// fired_at to the next chronological fire on the job (frozen), or to now
// (live, 60s ticker — ClockButton convention). Pure client math off stored
// fired_at; parents decide which events exist and whether the job is running.
// Sibling of OnSiteElapsedChip (which keeps its distinct "On site" role).
// SQL counterpart: job_stage_durations_v (same precedence + window semantics).

import { useEffect, useState } from "react";

export type StageEvent = {
  trigger_number: number;
  fired_at: string;
  origin: string | null;
  fired_by?: string | null;
};

export type StageWindow = {
  at: string;
  origin: string | null;
  fired_by: string | null;
  endedAt: string | null; // next chronological fire; null = open stage
};

export function fmtStage(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtPressTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit",
  });
}

// Canonical timestamp for one trigger: prefer real presses over hcp_derived
// mirrors, then latest fired_at — the A2 on-site-chip precedence, generalized.
export function canonicalStageAt(events: StageEvent[], n: number):
  { at: string; origin: string | null; fired_by: string | null } | null {
  const rows = events.filter((e) => e.trigger_number === n);
  if (rows.length === 0) return null;
  const pressed = rows.filter((e) => e.origin !== "hcp_derived");
  const pool = pressed.length > 0 ? pressed : rows;
  const best = pool.reduce((m, e) => (e.fired_at > m.fired_at ? e : m), pool[0]);
  return { at: best.fired_at, origin: best.origin, fired_by: best.fired_by ?? null };
}

// Stage windows over a job: canonical time per trigger, sorted chronologically;
// each stage ends at the next fire, the last stays open (endedAt null).
export function buildStageWindows(events: StageEvent[], triggerNumbers: number[]):
  Map<number, StageWindow> {
  const canon: Array<{ n: number } & StageWindow> = [];
  for (const n of triggerNumbers) {
    const c = canonicalStageAt(events, n);
    if (c) canon.push({ n, at: c.at, origin: c.origin, fired_by: c.fired_by, endedAt: null });
  }
  canon.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.n - b.n));
  const out = new Map<number, StageWindow>();
  canon.forEach((c, i) => {
    out.set(c.n, {
      at: c.at, origin: c.origin, fired_by: c.fired_by,
      endedAt: i + 1 < canon.length ? canon[i + 1].at : null,
    });
  });
  return out;
}

export function TriggerStageClock({ firedAt, endedAt, live }: {
  firedAt: string;
  endedAt: string | null; // next chronological fire; null = open stage
  live: boolean;          // parent gate: job still running (not finished/done/canceled)
}) {
  const running = live && !endedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [running, firedAt]);

  const start = Date.parse(firedAt);
  if (!Number.isFinite(start)) return null;
  // Open stage on a job that's no longer running (ended without an end event):
  // nothing honest to show — the caption falls back to its non-clock text.
  if (!endedAt && !running) return null;
  const end = endedAt ? Date.parse(endedAt) : now;
  if (!Number.isFinite(end)) return null;

  return (
    <span className={`tabular-nums ${running ? "font-semibold text-emerald-700" : ""}`}>
      {fmtStage(end - start)}
    </span>
  );
}
