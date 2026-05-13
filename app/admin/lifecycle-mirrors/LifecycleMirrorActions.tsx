"use client";

// Per-row admin actions for /admin/lifecycle-mirrors.

import { useState, useTransition } from "react";
import { retryHcpMirror, resolveHcpMirror } from "./actions";

export function LifecycleMirrorActions({
  eventId,
  hcpJobId,
  hcpAction,
}: {
  eventId: string;
  hcpJobId: string;
  hcpAction: string;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <div className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
        ✓ {msg ?? "Resolved"}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setErr(null); setMsg(null);
          startTransition(async () => {
            const res = await retryHcpMirror({ hcp_job_id: hcpJobId, action: hcpAction });
            if (res.ok) {
              setMsg(`Retried — request ${res.request_id?.slice(0, 8)}…`);
              setDismissed(true);
            } else {
              setErr(res.error);
            }
          });
        }}
        className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {pending ? "Retrying…" : "↻ Retry mirror"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setErr(null); setMsg(null);
          startTransition(async () => {
            const res = await resolveHcpMirror({ event_id: eventId, note: "Fixed in HCP manually" });
            if (res.ok) {
              setMsg("Marked resolved");
              setDismissed(true);
            } else {
              setErr(res.error);
            }
          });
        }}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        Mark resolved
      </button>
      {err ? <span className="text-xs text-red-700">{err}</span> : null}
    </div>
  );
}
