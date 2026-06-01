"use client";

// OMW-without-Finish guard modal (Danny's spec, 2026-06-01). Shown when a tech
// presses "On My Way" for the next job while a PRIOR job is still open (started,
// never Finished). Asks: Finish it / Pause / Other (+ speech-to-text note).
// After the choice, onProceed() fires the deferred On-My-Way on the new job.
//   - Finish → fires lifecycle trigger 6 on the OLD job (mirrors to HCP).
//   - Pause / Other → job_pause_log ack (keeps the old job open/resumable).
//   - Cancel → abort; don't send On My Way at all.

import { useState, useTransition } from "react";
import { pauseOpenJob, type OpenJob } from "@/lib/omw-guard-actions";
import { fireLifecycleTrigger } from "@/app/me/lifecycle-actions";
import { SpeechToTextButton } from "./SpeechToTextButton";

export function OmwGuardModal({
  openJob,
  onProceed,
  onCancel,
}: {
  openJob: OpenJob;
  onProceed: () => void;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<null | "other">(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const who = openJob.customer_name ? `“${openJob.customer_name}”` : "your last job";

  const doFinish = () =>
    start(async () => {
      setError(null);
      const r = await fireLifecycleTrigger({
        trigger_number: 6,
        hcp_job_id: openJob.hcp_job_id,
        hcp_customer_id: openJob.hcp_customer_id ?? undefined,
        hcp_appointment_id: openJob.appointment_id ?? undefined,
      });
      if (!r.ok) { setError(r.error ?? "failed"); return; }
      onProceed();
    });

  const doPause = () =>
    start(async () => {
      setError(null);
      const r = await pauseOpenJob({ hcp_job_id: openJob.hcp_job_id, hcp_customer_id: openJob.hcp_customer_id, kind: "pause" });
      if (!r.ok) { setError(r.error ?? "failed"); return; }
      onProceed();
    });

  const doOther = () =>
    start(async () => {
      setError(null);
      const r = await pauseOpenJob({ hcp_job_id: openJob.hcp_job_id, hcp_customer_id: openJob.hcp_customer_id, kind: "other", note });
      if (!r.ok) { setError(r.error ?? "failed"); return; }
      onProceed();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-neutral-900">Finish {who} first?</h3>
        <p className="mt-1 text-sm text-neutral-600">
          You pressed <strong>On My Way</strong> for the next job, but {who} is still open
          ({openJob.last_action_label.toLowerCase()}, never marked Finished). Did you mean to
          Finish it, or is someone else still working on it?
        </p>

        {mode !== "other" ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button type="button" onClick={doFinish} disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              ✅ Finish it
            </button>
            <button type="button" onClick={doPause} disabled={pending} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              ⏸ Pause
            </button>
            <button type="button" onClick={() => setMode("other")} disabled={pending} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
              … Other
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">What&apos;s going on?</label>
              <SpeechToTextButton onTranscript={(t) => setNote((n) => (n ? n + " " : "") + t)} />
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. crew still on site finishing up; I'll close it later"
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="flex gap-2">
              <button type="button" onClick={doOther} disabled={pending} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? "Saving…" : "Save + continue"}
              </button>
              <button type="button" onClick={() => setMode(null)} disabled={pending} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50">
                back
              </button>
            </div>
          </div>
        )}

        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}

        <div className="mt-4 border-t border-neutral-100 pt-3 text-right">
          <button type="button" onClick={onCancel} disabled={pending} className="text-xs text-neutral-400 hover:text-neutral-700">
            Cancel — don&apos;t send On My Way
          </button>
        </div>
      </div>
    </div>
  );
}
