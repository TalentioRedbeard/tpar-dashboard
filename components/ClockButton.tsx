"use client";

// Big clock-in / clock-out button — primary surface on the home page.
// Mobile-first: full-width tap target, ample padding. Desktop: side-by-side.

import { useState, useTransition, useEffect } from "react";
import { clockIn, clockOut, type CurrentClockState } from "@/app/time/actions";

type Props = {
  initial: CurrentClockState;
  techShortName: string | null;
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function ClockInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ClockOutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M7 10h6M10 7v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

export function ClockButton({ initial, techShortName }: Props) {
  const [state, setState] = useState<CurrentClockState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Tick every minute when clocked in so duration display updates without a server hit
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.state !== "clocked-in") return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [state.state]);

  function captureLocation(): Promise<{ lat: number; lng: number; accuracy_m?: number } | undefined> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }),
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
  const liveDuration = isClockedIn
    ? Math.max(0, Math.floor((now - new Date(state.clocked_in_at).getTime()) / 1000))
    : 0;

  // Tone: green = ready to clock in; red = currently clocked in (action stops the timer)
  const containerCls = isClockedIn
    ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white"
    : "border-brand-200 bg-gradient-to-br from-brand-50 to-white";

  const buttonCls = isClockedIn
    ? "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-400 ring-1 ring-inset ring-red-700/30"
    : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-400 ring-1 ring-inset ring-emerald-700/30";

  const buttonLabel = pending ? "…" : isClockedIn ? "Clock out" : "Clock in";

  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md " +
        containerCls
      }
    >
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/60 blur-2xl" />
      <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
        <div className="flex flex-1 flex-col">
          <div className="flex items-baseline gap-2">
            {isClockedIn && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
              {techShortName ? `${techShortName} · ` : ""}
              {isClockedIn ? "On the clock" : "Off the clock"}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            {isClockedIn ? (
              <>
                <span className="text-3xl font-semibold leading-none tabular-nums tracking-tight text-emerald-700">
                  {formatDuration(liveDuration)}
                </span>
                <span className="text-sm text-neutral-600">since {formatTime(state.clocked_in_at)}</span>
              </>
            ) : state.last_clock_out_at ? (
              <>
                <span className="text-2xl font-semibold leading-none tabular-nums tracking-tight text-neutral-900">
                  Ready
                </span>
                <span className="text-sm text-neutral-500">last out at {formatTime(state.last_clock_out_at)}</span>
              </>
            ) : (
              <span className="text-2xl font-semibold leading-none tabular-nums tracking-tight text-neutral-900">
                Ready
              </span>
            )}
          </div>
          {error && <div className="mt-2 text-sm text-red-700">{error}</div>}
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          className={
            "inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold shadow-sm transition sm:w-auto sm:min-w-[140px] " +
            buttonCls
          }
        >
          {isClockedIn ? <ClockOutIcon /> : <ClockInIcon />}
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
