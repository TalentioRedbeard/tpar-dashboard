// StatCard — labeled metric tile. Used in 360 views, /me snapshot, hero
// strips. Accepts an optional tone for emphasis (red for due, amber for
// open follow-ups, green for positive signals).

import type { ReactNode } from "react";

export type StatTone = "neutral" | "red" | "amber" | "green" | "brand";

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-neutral-900",
  red:     "text-red-700",
  amber:   "text-accent-700",
  green:   "text-emerald-700",
  brand:   "text-brand-700",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: string | number | ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  emphasis?: boolean;
}) {
  const ring = emphasis ? "ring-1 ring-inset ring-brand-200" : "";
  return (
    <div className={`rounded-2xl border border-neutral-200 bg-white p-4 ${ring}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${VALUE_TONE[tone]}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}
