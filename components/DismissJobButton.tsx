"use client";

// "Mark handled" — clears the appointment from /me without firing any HCP
// lifecycle trigger. Persists in tech_appointment_dismissals. Restorable from
// the "Dismissed today" section on /me.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissAppointment, restoreAppointment } from "@/app/me/dismissal-actions";

export function DismissJobButton({
  appointmentId,
  hcpJobId,
  variant = "dismiss",
}: {
  appointmentId: string | null;
  hcpJobId: string | null;
  variant?: "dismiss" | "restore";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function go() {
    setErr(null);
    start(async () => {
      const res = variant === "dismiss"
        ? await dismissAppointment({ appointmentId, hcpJobId })
        : await restoreAppointment({ appointmentId, hcpJobId });
      if (res.ok) router.refresh();
      else setErr(res.error ?? "Failed");
    });
  }

  if (variant === "restore") {
    return (
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
        title="Restore to your day"
      >
        {pending ? "…" : "↺ Restore"}
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
        title="Mark handled — clears from your dashboard, does NOT fire anything in HCP"
      >
        {pending ? "…" : "✓ Mark handled"}
      </button>
      {err ? <span className="text-[10px] text-red-600">{err}</span> : null}
    </div>
  );
}
