"use client";

import { useState } from "react";

// Two-way view toggle. Renders two server-provided subtrees (both mounted,
// CSS-hidden so state/scroll survive) and flips which is visible. Primary shows
// first. Used by /dispatch (Map+Queues / Board) and /schedule for techs
// (My schedule / Full board). Client state only — resets on navigation.
export function ViewToggle({
  primaryLabel,
  primary,
  secondaryLabel,
  secondary,
}: {
  primaryLabel: string;
  primary: React.ReactNode;
  secondaryLabel: string;
  secondary: React.ReactNode;
}) {
  const [view, setView] = useState<"primary" | "secondary">("primary");
  return (
    <>
      <div className="mb-3 inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setView("primary")}
          aria-pressed={view === "primary"}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === "primary" ? "bg-brand-100 text-brand-900" : "text-neutral-600 hover:bg-neutral-100"}`}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={() => setView("secondary")}
          aria-pressed={view === "secondary"}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === "secondary" ? "bg-brand-100 text-brand-900" : "text-neutral-600 hover:bg-neutral-100"}`}
        >
          {secondaryLabel}
        </button>
      </div>
      <div className={view === "primary" ? undefined : "hidden"}>{primary}</div>
      <div className={view === "secondary" ? undefined : "hidden"}>{secondary}</div>
    </>
  );
}
