"use client";

// Prominent "Job Briefing" card at the top of the job page. Shows the owner's
// pre-job voice-note briefing (with a one-tap per-tech "Reviewed" ack) AND any
// emails pinned to this job/customer that the viewer is allowed to see (with
// their handling notes). Renders if there's a briefing OR pinned emails.

import { useState, useTransition } from "react";
import { markBriefingReviewed, type Briefing } from "../app/job/[id]/briefing-actions";
import type { PinnedEmail } from "../app/customer/[id]/email-actions";

function fmtChi(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function JobBriefingCard({
  hcpJobId,
  briefing,
  pinnedEmails = [],
}: {
  hcpJobId: string;
  briefing: Briefing | null;
  pinnedEmails?: PinnedEmail[];
}) {
  const [reviewed, setReviewed] = useState(briefing?.reviewedByMe ?? false);
  const [pending, start] = useTransition();

  if (!briefing && pinnedEmails.length === 0) return null;

  const unreviewed = !!briefing && !reviewed;
  const tone = unreviewed ? "border-amber-400 bg-amber-50" : briefing ? "border-emerald-300 bg-emerald-50/50" : "border-neutral-200 bg-white";

  return (
    <div className={`mb-6 rounded-2xl border-2 p-4 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
          📋 Job briefing
          {briefing ? (
            unreviewed
              ? <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Review before you head out</span>
              : <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">Reviewed ✓</span>
          ) : null}
        </h2>
        {briefing ? (
          <span className="text-xs text-neutral-500">
            {briefing.authorShortName ?? briefing.authorEmail ?? "—"} · {fmtChi(briefing.ts)}
            {briefing.durationSeconds ? ` · ${Math.round(briefing.durationSeconds)}s` : ""}
          </span>
        ) : null}
      </div>

      {briefing ? (
        <>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{briefing.transcript}</p>
          <div className="mt-3">
            {unreviewed ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => { const r = await markBriefingReviewed(hcpJobId, briefing.voiceNoteId); if (r.ok) setReviewed(true); })}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {pending ? "Saving…" : "I've reviewed this ✓"}
              </button>
            ) : (
              <span className="text-xs font-medium text-emerald-800">
                ✓ You reviewed this briefing{briefing.reviewedByMeAt ? ` · ${fmtChi(briefing.reviewedByMeAt)}` : ""}
              </span>
            )}
          </div>
        </>
      ) : null}

      {pinnedEmails.length > 0 ? (
        <div className={briefing ? "mt-4 border-t border-neutral-200/70 pt-3" : "mt-2"}>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">📎 Related emails — review too</div>
          <ul className="mt-2 space-y-2">
            {pinnedEmails.map((e) => (
              <li key={e.pinId} className="rounded-lg border border-neutral-200 bg-white p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-900">{e.subject ?? "(no subject)"}</span>
                  <span className="text-xs text-neutral-400">{e.fromName ?? e.fromAddress ?? "—"} · {fmtChi(e.receivedAt)}</span>
                </div>
                {e.aiSummary ? <p className="mt-1 text-xs text-neutral-600">{e.aiSummary}</p> : null}
                {e.handlingNote ? (
                  <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900"><span className="font-semibold">Handle:</span> {e.handlingNote}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
