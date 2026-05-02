"use client";

// Small per-appointment clock-in button.
// Renders state-aware:
//   - tech is clocked in for THIS appointment → "On the clock" badge (no action)
//   - tech is clocked out → "Start" button (clocks in with this appointment's IDs)
//   - tech is clocked in for ANOTHER appointment → "Clocked in elsewhere" disabled chip
//
// Doesn't handle the "switch" case (clock out of A, into B) — that's a
// deliberate scope cut. Users clock out of the previous appointment first.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clockInForAppointment } from "@/app/time/actions";

type Props = {
  appointmentId: string | null;
  jobId: string | null;
  // Pass the current state so we can render appropriately
  isClockedInHere: boolean;
  isClockedInElsewhere: boolean;
};

export function StartAppointmentButton({
  appointmentId,
  jobId,
  isClockedInHere,
  isClockedInElsewhere,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isClockedInHere) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        On the clock here
      </span>
    );
  }
  if (isClockedInElsewhere) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-500">
        Clocked in elsewhere
      </span>
    );
  }
  if (!appointmentId) {
    return null; // can't start without an id
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await clockInForAppointment({
              hcp_appointment_id: appointmentId,
              ...(jobId ? { hcp_job_id: jobId } : {}),
            });
            if (!r.ok) {
              setError(r.error);
              return;
            }
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-400"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 2l6 4-6 4V2z" fill="currentColor" />
        </svg>
        {pending ? "..." : "Start"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
