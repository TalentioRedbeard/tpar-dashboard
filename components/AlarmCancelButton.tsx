"use client";

import { useState, useTransition } from "react";
import { cancelAlarm } from "@/app/alarms/actions";

export function AlarmCancelButton({ alarmId }: { alarmId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-700">Cancel?</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await cancelAlarm(alarmId);
              if (!r.ok) setError(r.error);
              setConfirming(false);
            });
          }}
          className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:bg-red-300"
        >
          {pending ? "..." : "Yes, cancel"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-neutral-700 hover:bg-neutral-50"
        >
          Keep
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
    >
      Cancel alarm
    </button>
  );
}
