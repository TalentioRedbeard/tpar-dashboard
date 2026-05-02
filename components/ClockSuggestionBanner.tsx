"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptSuggestion, dismissSuggestion, type Suggestion } from "@/app/time/suggestions";

type Props = {
  suggestion: Suggestion;
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ClockSuggestionBanner({ suggestion }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const distance = suggestion.match_distance_meters
    ? `${Math.round(suggestion.match_distance_meters)}m`
    : "nearby";
  const minOff = suggestion.match_minutes_off_schedule;
  const offLabel =
    minOff == null ? "" :
    minOff <= 5 ? "right on time" :
    minOff <= 30 ? `${minOff}m off schedule` :
    `${minOff}m off (well off schedule — verify)`;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-emerald-200/40 blur-2xl" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1c-2.5 0-4.5 2-4.5 4.5C2.5 9 7 13 7 13s4.5-4 4.5-7.5C11.5 3 9.5 1 7 1z" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="7" cy="5.5" r="1.5" fill="currentColor" />
            </svg>
            Looks like you arrived
          </div>
          <div className="text-base font-semibold text-emerald-900">
            {suggestion.customer_name ?? "(unnamed customer)"}
          </div>
          <div className="text-xs text-emerald-700/80">
            {suggestion.scheduled_start ? `scheduled ${formatTime(suggestion.scheduled_start)} · ` : ""}
            {distance} away{offLabel ? ` · ${offLabel}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await acceptSuggestion(suggestion.id);
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setHidden(true);
                router.refresh();
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-400"
          >
            {pending ? "..." : "Clock in here"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await dismissSuggestion(suggestion.id);
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setHidden(true);
                router.refresh();
              });
            }}
            className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
      {error && <div className="relative mt-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}
