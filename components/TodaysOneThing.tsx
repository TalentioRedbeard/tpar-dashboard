// TodaysOneThing — a small /me card surfacing ONE Field Doctrine principle,
// rotating daily (picked server-side by lib/field-doctrine.getDailyPrinciple:
// day-of-year in America/Chicago % principle count — same pick for the whole
// crew all day). Quiet but unmissable: big icon, the rule as the headline,
// one line of detail, and a tiny "Field guide →" link into /how-to#doctrine.
//
// Server component (no "use client") — the pick comes in as a prop.

import Link from "next/link";
import type { DoctrineRow } from "../lib/field-doctrine";

export function TodaysOneThing({ principle }: { principle: DoctrineRow | null }) {
  if (!principle) return null;
  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 rounded-2xl border-2 border-brand-200 bg-white p-4 shadow-sm">
        <span aria-hidden className="shrink-0 text-4xl leading-none">{principle.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gold-600">
              Today&rsquo;s one thing
            </span>
            <Link
              href="/how-to#doctrine"
              className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
            >
              Field guide →
            </Link>
          </div>
          <div className="mt-0.5 text-sm font-bold leading-snug text-neutral-900">{principle.rule}</div>
          {principle.detail ? (
            <p className="mt-0.5 truncate text-xs text-neutral-600">{principle.detail}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
