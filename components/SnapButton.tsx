"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestScreenshot } from "@/app/snap/actions";

export function SnapButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await requestScreenshot({});
            if (!r.ok) { setError(r.error); return; }
            setLastRequestId(r.request_id);
            router.refresh();
          });
        }}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-brand-700 px-6 py-6 text-lg font-semibold text-white shadow-lg transition hover:bg-brand-800 active:bg-brand-900 disabled:bg-brand-400"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
          <circle cx="12" cy="12.5" r="3.5" stroke="currentColor" strokeWidth="2"/>
          <path d="M9 6l1-2h4l1 2" stroke="currentColor" strokeWidth="2"/>
        </svg>
        {pending ? "Requesting…" : "Snap my laptop"}
      </button>
      {lastRequestId && (
        <div className="text-xs text-emerald-700">
          Request queued · ID {lastRequestId.slice(0, 8)}…
          <br />
          The poller takes ≤ 5 seconds to pick up. You&apos;ll get a Slack DM with the screenshot URL.
        </div>
      )}
      {error && <div className="text-xs text-red-700">{error}</div>}
    </div>
  );
}
