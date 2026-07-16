"use client";

// The tech estimates list, searchable (A6, 2026-07-16 — mirrors the customers
// page treatment Danny asked for): instant local filter over the full-history
// list (customer name / estimate #) + chips. "Awaiting" stands in for the
// customers page's "Upcoming" — estimates carry no future dates, and awaiting
// a decision is the actionable set.

import { useMemo, useState } from "react";
import Link from "next/link";

export type EstRow = {
  id: string;             // hcp_estimate_id (list key)
  href: string;           // in-app target, precomputed server-side
  customerName: string;
  estimateNumber: string; // without '#', may be ""
  stage: string;          // lowercase stage word ("awaiting" default)
  amountLabel: string;
  lastActivity: string | null; // ISO
};

const CHI = "America/Chicago";
function fmtDay(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
}
function stagePill(s: string): { cls: string; label: string } {
  if (s === "won") return { cls: "bg-emerald-100 text-emerald-800", label: s };
  if (s === "awaiting") return { cls: "bg-brand-100 text-brand-800", label: s };
  if (s === "declined") return { cls: "bg-amber-100 text-amber-800", label: s };
  return { cls: "bg-neutral-100 text-neutral-500", label: s };
}

type Chip = "all" | "awaiting" | "recent" | "az";

export function TechEstimatesList({ rows }: { rows: EstRow[] }) {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("all");

  const qNorm = q.trim().toLowerCase().replace(/^#/, "");
  const filtered = useMemo(() => {
    let out = rows;
    if (qNorm) {
      out = out.filter(
        (r) => r.customerName.toLowerCase().includes(qNorm) || r.estimateNumber.startsWith(qNorm),
      );
    }
    const now = Date.now();
    if (chip === "awaiting") out = out.filter((r) => r.stage === "awaiting");
    if (chip === "recent") out = out.filter((r) => r.lastActivity && now - new Date(r.lastActivity).getTime() < 90 * 86_400_000);
    if (chip === "az") out = [...out].sort((a, b) => a.customerName.localeCompare(b.customerName));
    return out;
  }, [rows, qNorm, chip]);

  const CHIPS: Array<[Chip, string]> = [
    ["all", "All"], ["awaiting", "Awaiting"], ["recent", "Last 90 days"], ["az", "A–Z"],
  ];

  return (
    <div>
      <div className="mb-3 space-y-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={'customer name or estimate # — "crow" / "27665"'}
          className="block w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map(([c, label]) => (
            <button key={c} type="button" onClick={() => setChip(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${chip === c ? "bg-brand-700 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 text-xs text-neutral-500">
        {filtered.length} estimate{filtered.length === 1 ? "" : "s"}{qNorm || chip !== "all" ? " matching" : " on your customers"}
      </div>

      <ul className="space-y-2">
        {filtered.map((e) => {
          const pill = stagePill(e.stage);
          return (
            <li key={e.id}>
              <Link href={e.href} className="block">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 hover:border-brand-300 hover:shadow-sm">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-900">
                      {e.estimateNumber ? `#${e.estimateNumber}` : "Estimate"} · {e.customerName}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500">{e.amountLabel} · {fmtDay(e.lastActivity)}</div>
                  </div>
                  <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {qNorm && filtered.length === 0 ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500">
          Nothing matches &ldquo;{q}&rdquo;. Try the customer&apos;s name or the estimate number — the list covers your full work history.
        </div>
      ) : null}
    </div>
  );
}
