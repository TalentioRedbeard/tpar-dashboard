"use client";

import { useState, useTransition } from "react";
import { fireLifecycleTrigger } from "@/app/me/lifecycle-actions";

type Props = {
  hcpJobId: string;
  hcpAppointmentId: string | null;
  // Trigger numbers already fired for this appointment (so we can show completed state)
  firedTriggers: number[];
};

const BUTTONS: Array<{
  trigger: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  label: string;
  variant: "primary" | "secondary" | "danger";
}> = [
  { trigger: 2, label: "On my way", variant: "secondary" },
  { trigger: 3, label: "Start", variant: "secondary" },
  { trigger: 4, label: "Build estimate", variant: "secondary" },
  { trigger: 5, label: "Present", variant: "secondary" },
  { trigger: 6, label: "Finish work", variant: "secondary" },
  { trigger: 7, label: "Done", variant: "primary" },
];

export function LifecycleButtons({ hcpJobId, hcpAppointmentId, firedTriggers }: Props) {
  const [pending, startTransition] = useTransition();
  const [lastFired, setLastFired] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFire = (triggerNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7) => {
    startTransition(async () => {
      setError(null);
      const res = await fireLifecycleTrigger({
        trigger_number: triggerNumber,
        hcp_job_id: hcpJobId,
        hcp_appointment_id: hcpAppointmentId ?? undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLastFired(triggerNumber);
    });
  };

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap gap-1.5">
        {BUTTONS.map((b) => {
          const wasFired = firedTriggers.includes(b.trigger) || lastFired === b.trigger;
          const baseClass =
            "rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50";
          const variantClass = wasFired
            ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
            : b.variant === "primary"
              ? "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50";
          return (
            <button
              key={b.trigger}
              type="button"
              disabled={pending}
              onClick={() => onFire(b.trigger)}
              className={`${baseClass} ${variantClass}`}
              title={`Fire trigger ${b.trigger}`}
            >
              {wasFired ? "✓ " : ""}{b.label}
            </button>
          );
        })}
      </div>
      {error ? <div className="mt-1 text-xs text-red-700">{error}</div> : null}
    </div>
  );
}
