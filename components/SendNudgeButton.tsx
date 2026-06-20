"use client";

// "Send this nudge" — the one-click action on a Phase-3 estimate_nudge_approval task in the
// dispatch Task List. Calls sendApprovedNudge, which re-validates eligibility + segment at
// click time, sends via Resend, and marks the task done on a real send. Mirrors SendEstimateButton.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendApprovedNudge } from "@/app/dispatch/followup-actions";

export function SendNudgeButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function go() {
    setErr(null);
    setNote(null);
    start(async () => {
      const r = await sendApprovedNudge(taskId);
      if (r.ok) {
        setDone(true);
        if (r.note) setNote(r.note);
        router.refresh();
      } else {
        setErr(r.error);
      }
    });
  }

  if (done) {
    return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">{note ? "✓ closed" : "✓ sent"}</span>;
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={go}
        className="rounded border border-emerald-400 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
      >
        {pending ? "Sending…" : "📤 Send this nudge"}
      </button>
      {err ? <span className="text-[10px] text-red-700">{err}</span> : null}
    </>
  );
}
