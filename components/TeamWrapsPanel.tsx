"use client";

// Team wraps section on /conversation — power-center-point slice 4. The hourly
// tech-wrap-distill sweep turns each tech's end-of-day verbal wrap (DailyWrapCard
// on /me) into recap + requirements + blockers + highlights in tech_daily_wraps.
// This is the owner's review surface: last 3 days grouped by date then tech, with
// a "Make task" button that promotes a requirement into the tasks table (the
// "funnel of requirement" — nothing auto-assigns).

import { useState, useTransition } from "react";
import { makeTaskFromWrap } from "@/app/conversation/wrap-actions";

export type WrapRequirement = { area: string; text: string };
export type TechWrap = {
  id: string;
  wrap_date: string;
  tech: string;
  recording_id: string;
  recap: string;
  requirements: WrapRequirement[];
  blockers: string[];
  highlights: string[];
};

function RequirementRow({ wrapId, index, req }: { wrapId: string; index: number; req: WrapRequirement }) {
  const [made, setMade] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const make = () => {
    setError(null);
    startTransition(async () => {
      const r = await makeTaskFromWrap({ wrapId, reqIndex: index });
      if (r.ok) setMade(true);
      else setError(r.error);
    });
  };

  return (
    <li className="rounded-md border border-navy-900/10 bg-navy-900/[0.02] p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-full bg-gold-500/20 px-2 py-0.5 text-[11px] font-medium text-navy-900/70">
          {req.area}
        </span>
        <span className="min-w-0 flex-1 text-sm text-navy-900/90">{req.text}</span>
        {made ? (
          <span className="shrink-0 pt-0.5 text-xs font-medium text-emerald-700">Task created ✓</span>
        ) : (
          <button
            type="button"
            onClick={make}
            disabled={pending}
            className="shrink-0 rounded-md bg-navy-900 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60"
          >
            {pending ? "Making…" : "Make task"}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-700">Couldn&apos;t create: {error}</p>}
    </li>
  );
}

function WrapCard({ wrap }: { wrap: TechWrap }) {
  return (
    <li className="space-y-2 rounded-md border border-navy-900/10 p-3">
      <p className="font-semibold text-navy-900">{wrap.tech}</p>
      {wrap.recap && <p className="whitespace-pre-wrap text-sm text-navy-900/80">{wrap.recap}</p>}

      {wrap.highlights.length > 0 && (
        <ul className="space-y-1">
          {wrap.highlights.map((h, i) => (
            <li key={i} className="rounded-md border border-gold-500/30 bg-gold-500/[0.06] px-2.5 py-1.5 text-xs text-emerald-800">
              ✦ {h}
            </li>
          ))}
        </ul>
      )}

      {wrap.blockers.length > 0 && (
        <ul className="space-y-1">
          {wrap.blockers.map((b, i) => (
            <li key={i} className="rounded-md border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900">
              ⚠ {b}
            </li>
          ))}
        </ul>
      )}

      {wrap.requirements.some((r) => r.text) && (
        <ul className="space-y-1.5">
          {wrap.requirements.map((r, i) =>
            r.text ? <RequirementRow key={i} wrapId={wrap.id} index={i} req={r} /> : null,
          )}
        </ul>
      )}
    </li>
  );
}

export function TeamWrapsPanel({ wraps }: { wraps: TechWrap[] }) {
  // Group by date desc (page query orders wrap_date desc, tech asc — Map keeps order).
  const byDate = new Map<string, TechWrap[]>();
  for (const w of wraps) {
    const list = byDate.get(w.wrap_date) ?? [];
    list.push(w);
    byDate.set(w.wrap_date, list);
  }

  return (
    <section className="space-y-5 rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-navy-900">Team wraps</h2>
        <p className="text-xs text-navy-900/60">
          The techs&apos; end-of-day verbal wraps, distilled — promote a requirement to a task when it&apos;s worth building.
        </p>
      </div>

      {wraps.length === 0 ? (
        <p className="text-sm text-navy-900/50">No wraps in the last 3 days.</p>
      ) : (
        <div className="space-y-4">
          {[...byDate.entries()].map(([date, dayWraps]) => (
            <div key={date} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-900/50">{date}</h3>
              <ul className="space-y-2">
                {dayWraps.map((w) => (
                  <WrapCard key={w.id} wrap={w} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
