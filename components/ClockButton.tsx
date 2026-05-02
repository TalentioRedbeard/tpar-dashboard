"use client";

// Big clock-in / clock-out button for the dashboard home screen.
//
// Pattern: client component with optimistic-ish UX. Reads initial state
// from a prop (the server already knows it from getCurrentState), then
// calls server actions for mutations. The actions call revalidatePath on
// "/" and "/time" so subsequent reads pick up the new state.

import { useState, useTransition, useEffect } from "react";
import { clockIn, clockOut, type CurrentClockState } from "@/app/time/actions";

type Props = {
  initial: CurrentClockState;
  techShortName: string | null;
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ClockButton({ initial, techShortName }: Props) {
  const [state, setState] = useState<CurrentClockState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Tick a local timer every minute when clocked in so the duration display
  // updates without a server round-trip. Doesn't change the underlying state.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.state !== "clocked-in") return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [state.state]);

  function captureLocation(): Promise<{ lat: number; lng: number; accuracy_m?: number } | undefined> {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        }),
        () => resolve(undefined),
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 },
      );
    });
  }

  async function handleClick() {
    setError(null);
    const location = await captureLocation();
    const client_reported_at = new Date().toISOString();

    startTransition(async () => {
      const result =
        state.state === "clocked-in"
          ? await clockOut({ location, client_reported_at })
          : await clockIn({ location, client_reported_at });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setState(result.state);
      setNow(Date.now());
    });
  }

  const isClockedIn = state.state === "clocked-in";
  const buttonLabel = pending
    ? "..."
    : isClockedIn
    ? "Clock out"
    : "Clock in";

  const liveDuration =
    isClockedIn
      ? Math.max(0, Math.floor((now - new Date(state.clocked_in_at).getTime()) / 1000))
      : 0;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-brand-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col">
        <div className="text-sm text-brand-700">
          {techShortName ? `${techShortName} —` : ""} {isClockedIn ? "On the clock" : "Off the clock"}
        </div>
        <div className="text-base font-medium text-brand-900">
          {isClockedIn
            ? `Started ${formatTime(state.clocked_in_at)} · ${formatDuration(liveDuration)} elapsed`
            : state.last_clock_out_at
              ? `Last out at ${formatTime(state.last_clock_out_at)}`
              : "No history yet"}
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={
          "rounded-xl px-6 py-3 text-base font-semibold shadow-sm transition " +
          (isClockedIn
            ? "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400"
            : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-400")
        }
      >
        {buttonLabel}
      </button>
    </div>
  );
}
