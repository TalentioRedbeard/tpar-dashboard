"use client";

// OnSiteElapsedChip — live "🟢 On site — 47m" counter shown once a job's Start
// trigger has fired. Pure client math off the stored fired_at (no new sync,
// no polling — the 15-min cron reality stays invisible); parent decides
// visibility (hides it once Finish/Done fires). Ticker pattern follows
// ClockButton (60s interval, h/m format, tabular-nums).

import { useEffect, useState } from "react";

function fmtElapsed(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function OnSiteElapsedChip({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-emerald-800"
      title={`Start pressed at ${new Date(start).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}`}
    >
      <span aria-hidden className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      On site — {fmtElapsed(now - start)}
    </span>
  );
}
