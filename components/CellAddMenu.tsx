"use client";

// Schedule cell quick-add (#20). A "+" that opens a tiny menu to create a job /
// estimate / event for a specific tech + day, launching the existing create
// flows with the date + tech prefilled (?date=…&tech=…).

import { useState } from "react";
import Link from "next/link";

export function CellAddMenu({ techFull, dateKey, compact }: { techFull: string | null; dateKey: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const techParam = techFull && techFull !== "Unassigned" ? `&tech=${encodeURIComponent(techFull)}` : "";
  const q = `?date=${dateKey}${techParam}`;
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Create here${techFull && techFull !== "Unassigned" ? ` for ${techFull.split(" ")[0]}` : ""}`}
        className={`flex items-center justify-center rounded border border-dashed border-neutral-300 text-neutral-400 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 ${compact ? "h-5 w-5 text-xs" : "h-6 w-6 text-sm"}`}
      >
        +
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 z-50 mt-1 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 text-xs shadow-lg">
            <Link href={`/dispatch/new-job${q}`} className="block px-3 py-1.5 hover:bg-neutral-50">🧰 New job</Link>
            <Link href={`/dispatch/new-estimate${q}`} className="block px-3 py-1.5 hover:bg-neutral-50">📝 New estimate</Link>
            <Link href={`/dispatch/new-event${q}`} className="block px-3 py-1.5 hover:bg-neutral-50">📅 New event</Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
