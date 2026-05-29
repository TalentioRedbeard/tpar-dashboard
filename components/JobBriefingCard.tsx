"use client";

// Prominent "Job Briefing" card — the owner/dispatcher's pre-job voice note,
// pulled to the top of the job page so the tech reads it before working. One-
// tap "Reviewed" ack (tracked per tech). Unreviewed = amber/attention; reviewed
// = calm/green.

import { useState, useTransition } from "react";
import { markBriefingReviewed, type Briefing } from "../app/job/[id]/briefing-actions";

function fmtChi(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function JobBriefingCard({ hcpJobId, briefing }: { hcpJobId: string; briefing: Briefing | null }) {
  const [reviewed, setReviewed] = useState(briefing?.reviewedByMe ?? false);
  const [pending, start] = useTransition();

  if (!briefing) return null;

  const unreviewed = !reviewed;

  return (
    <div className={`mb-6 rounded-2xl border-2 p-4 shadow-sm ${unreviewed ? "border-amber-400 bg-amber-50" : "border-emerald-300 bg-emerald-50/50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
          📋 Job briefing
          {unreviewed
            ? <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Review before you head out</span>
            : <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">Reviewed ✓</span>}
        </h2>
        <span className="text-xs text-neutral-500">
          {briefing.authorShortName ?? briefing.authorEmail ?? "—"} · {fmtChi(briefing.ts)}
          {briefing.durationSeconds ? ` · ${Math.round(briefing.durationSeconds)}s` : ""}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{briefing.transcript}</p>

      <div className="mt-4 flex items-center gap-3">
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
    </div>
  );
}
