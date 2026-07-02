"use client";

// The Daily Review section on /conversation — the "power center point" first slice.
// Press "Distill today" → the daily-review edge fn distills the day's office chunks
// into a structured wrap-up (summary + open threads to stew + tasks + process signals
// + owner-context kept). Shows the latest stored review on load; re-distilling replaces it.

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { distillToday, type DistillResult, type DailyReview } from "@/app/conversation/daily-review-actions";

const initial: DistillResult = { ok: null };

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-900/50">{title}</h3>
      {children}
    </div>
  );
}

export function DailyReviewPanel({
  stored, storedDate, storedSpan,
}: { stored: DailyReview | null; storedDate: string | null; storedSpan: string | null }) {
  const [state, formAction, pending] = useActionState(distillToday, initial);
  const router = useRouter();

  const review: DailyReview | null = state.ok === true ? state.review : stored;
  const date = state.ok === true ? state.review_date : storedDate;
  const span = state.ok === true ? state.source_span : storedSpan;

  return (
    <section className="space-y-5 rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy-900">Daily Review</h2>
          <p className="text-xs text-navy-900/60">
            {date ? `${date}${span ? ` · ${span}` : ""}` : "Distill the day's captured thinking into a wrap-up — so it stops living in your head."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {review && (
            <button type="button" onClick={() => router.refresh()} className="text-xs text-navy-900/50 transition hover:text-navy-900">↻</button>
          )}
          <form action={formAction}>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800 disabled:opacity-60"
            >
              {pending ? "Distilling…" : review ? "Re-distill today" : "Distill today"}
            </button>
          </form>
        </div>
      </div>

      {state.ok === false && <p className="text-sm text-red-700">Couldn&apos;t distill: {state.message}</p>}

      {!review ? (
        <p className="text-sm text-navy-900/50">No review yet — press <span className="font-medium">Distill today</span>.</p>
      ) : (
        <div className="space-y-5">
          {review.summary && (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-navy-900">{review.summary}</p>
          )}

          {review.open_threads.length > 0 && (
            <Group title="Open threads — left to stew">
              <ul className="space-y-2">
                {review.open_threads.map((t, i) => (
                  <li key={i} className="rounded-md border border-gold-500/30 bg-gold-500/[0.06] p-3 text-sm text-navy-900/90">{t}</li>
                ))}
              </ul>
            </Group>
          )}

          {review.tasks.length > 0 && (
            <Group title="Tasks">
              <ul className="space-y-2">
                {review.tasks.map((t, i) => (
                  <li key={i} className="rounded-md border border-navy-900/10 bg-navy-900/[0.02] p-3 text-sm">
                    <span className="font-semibold text-navy-900">{t.title}</span>
                    {t.detail ? <span className="text-navy-900/70"> — {t.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </Group>
          )}

          {review.process_signals.length > 0 && (
            <Group title="Process signals — where it snagged">
              <ul className="space-y-2">
                {review.process_signals.map((s, i) => (
                  <li key={i} className="rounded-md border border-navy-900/10 p-3 text-sm">
                    <p className="font-medium text-navy-900">{s.signal}</p>
                    {s.why ? <p className="mt-1 text-navy-900/60"><span className="font-medium">why:</span> {s.why}</p> : null}
                    {s.adapt ? <p className="mt-0.5 text-navy-900/60"><span className="font-medium">adapt:</span> {s.adapt}</p> : null}
                  </li>
                ))}
              </ul>
            </Group>
          )}

          {review.owner_context.length > 0 && (
            <Group title="Kept — your context">
              <ul className="space-y-1.5">
                {review.owner_context.map((c, i) => (
                  <li key={i} className="border-l-2 border-navy-900/20 pl-3 text-sm italic text-navy-900/80">{c}</li>
                ))}
              </ul>
            </Group>
          )}
        </div>
      )}
    </section>
  );
}
