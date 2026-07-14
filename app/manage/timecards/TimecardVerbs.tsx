"use client";

// One-tap dispositions for a timecard conflict entry, plus the per-week
// review signature button. Anti-stall: verbs are one tap, "Bring to Danny"
// is the tracked default (decision #9), and nothing here can edit a time.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjudicateTimecardEntry, escalateTimecardConflict, markWeekReviewed } from "./actions";

export function ConflictVerbs({
  hcpEmployeeId,
  techShortName,
  workDate,
  entryId,
  summary,
}: {
  hcpEmployeeId: string;
  techShortName: string | null;
  workDate: string;
  entryId: string | null;
  summary: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  function run(fn: () => Promise<{ ok: boolean; healed?: boolean; error?: string }>, doneMsg: string) {
    if (pending) return;
    setErr(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg(doneMsg);
        router.refresh();
      } else {
        setErr(r.error ?? "failed");
      }
    });
  }

  if (msg) return <div className="mt-1 text-[11px] font-semibold text-emerald-700">✓ {msg}</div>;

  const btn = "rounded px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40";

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => escalateTimecardConflict({ hcpEmployeeId, techShortName, workDate, summary }),
              "With Danny — flagged with the side-by-side",
            )
          }
          className={`${btn} bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300 hover:bg-amber-200`}
        >
          Bring to Danny
        </button>
        {entryId ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => adjudicateTimecardEntry({ hcpEmployeeId, techShortName, workDate, entryId, verb: "accept_hcp" }),
                  "HCP accepted — entry voided; clears on the next sync pass",
                )
              }
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
            >
              Accept HCP
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => adjudicateTimecardEntry({ hcpEmployeeId, techShortName, workDate, entryId, verb: "keep_app" }),
                  "App entry kept — correct HCP manually when convenient",
                )
              }
              className={`${btn} bg-neutral-200 text-neutral-800 hover:bg-neutral-300`}
            >
              Keep app
            </button>
          </>
        ) : null}
      </div>
      {err ? <div className="mt-0.5 text-[10px] text-red-600">{err}</div> : null}
    </div>
  );
}

export function WeekReviewedButton({ weekStart }: { weekStart: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  function sign() {
    if (pending) return;
    setErr(null);
    start(async () => {
      const r = await markWeekReviewed({ weekStart });
      if (r.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setErr(r.error ?? "failed");
      }
    });
  }

  return (
    <span className="flex items-center gap-2">
      {confirming ? (
        <>
          <span className="text-[11px] text-neutral-600">Sign off the whole pay week?</span>
          <button
            type="button"
            disabled={pending}
            onClick={sign}
            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {pending ? "Signing…" : "Yes — week reviewed"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-xs text-neutral-500 hover:text-neutral-700">
            cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          ✍️ Mark week reviewed
        </button>
      )}
      {err ? <span className="text-[10px] text-red-600">{err}</span> : null}
    </span>
  );
}
