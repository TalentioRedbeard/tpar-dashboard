"use client";

// Estimate badge + dropdown (2026-06-19). Rides schedule / job / /me cards and
// surfaces the HCP estimates tied to that card's customer (+ stronger job/appt
// ties). Mirrors the CellAddMenu dropdown idiom: useState(open) + fixed-inset
// backdrop + absolute panel, so the host page stays a server component.
//
// Data + dedup are done server-side (lib/estimates-for-cards). Link target is the
// HCP url (the csr_... estimate), opened in a new tab — NOT /estimate/[id], which
// only resolves bid_estimates UUIDs.
//
// CRITICAL: cards are wrapped in <Link href="/job/...">, so the badge button must
// preventDefault()+stopPropagation() or a click navigates instead of opening.

import { useState } from "react";
import type { CardEstimate } from "../lib/estimates-for-cards";

const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function amountLabel(e: CardEstimate): string {
  if (e.total_dollars == null || e.total_dollars <= 0) return "—";
  if (e.option_count > 1 && e.min_dollars != null && e.min_dollars < e.total_dollars) {
    return `${fmt(e.min_dollars)}–${fmt(e.total_dollars)}`;
  }
  return fmt(e.total_dollars);
}

function statusTone(s: string): string {
  switch (s) {
    case "won":
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "sent":
    case "scheduled":
      return "bg-blue-100 text-blue-800";
    case "needs scheduling":
      return "bg-amber-100 text-amber-800";
    case "canceled":
      return "bg-red-50 text-red-700";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

export function EstimateBadge({
  estimates,
  size = "sm",
}: {
  estimates: CardEstimate[];
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  if (!estimates || estimates.length === 0) return null;
  // Overflow line: any customer-thread row flags how many more exist in HCP.
  const overflow = estimates.reduce((m, e) => Math.max(m, e.customer_overflow), 0);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={`${estimates.length} estimate${estimates.length === 1 ? "" : "s"} on file`}
        className={`inline-flex items-center gap-0.5 rounded-sm bg-indigo-100 font-semibold text-indigo-900 hover:bg-indigo-200 ${
          size === "sm" ? "px-1 text-[9px]" : "px-1.5 py-0.5 text-[10px]"
        }`}
      >
        📝 {estimates.length}
      </button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
            aria-hidden
          />
          <div className="absolute right-0 z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 text-xs shadow-lg">
            {estimates.map((e) => (
              <a
                key={e.hcp_estimate_id}
                href={e.hcp_url}
                target="_blank"
                rel="noreferrer"
                onClick={(ev) => ev.stopPropagation()}
                className="flex items-start justify-between gap-2 px-3 py-1.5 hover:bg-neutral-50"
              >
                <span className="min-w-0">
                  <span className="font-mono font-semibold text-neutral-800">
                    #{e.estimate_number ?? "—"}
                  </span>
                  <span className={`ml-1 rounded-sm px-1 py-0.5 text-[9px] font-medium ${statusTone(e.display_status)}`}>
                    {e.display_status}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-neutral-700">
                  {amountLabel(e)}
                </span>
              </a>
            ))}
            {overflow > 0 ? (
              <div className="border-t border-neutral-100 px-3 py-1.5 text-[10px] text-neutral-500">
                + {overflow} more in HCP
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </span>
  );
}
