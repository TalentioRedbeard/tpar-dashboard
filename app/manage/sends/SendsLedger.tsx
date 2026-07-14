"use client";

// Client half of /manage/sends: lane chips + search over the server-merged
// ledger. Rows are already normalized and capped server-side.

import { useMemo, useState } from "react";
import Link from "next/link";

export type LedgerRow = {
  ts: string;
  lane: "estimate" | "followup" | "hcp" | "text" | "campaign" | "test";
  who: string;
  detail: string;
  status: string | null;
  statusTone: "ok" | "good" | "bad" | "muted";
  href: string | null;
};

const LANES: Array<{ key: LedgerRow["lane"] | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "estimate", label: "📧 Estimate emails" },
  { key: "followup", label: "🔁 Follow-ups" },
  { key: "hcp", label: "🏠 HCP emails" },
  { key: "text", label: "💬 Texts" },
  { key: "campaign", label: "📣 Campaigns" },
  { key: "test", label: "🧪 Tests" },
];

const LANE_BADGE: Record<LedgerRow["lane"], string> = {
  estimate: "📧 Estimate",
  followup: "🔁 Follow-up",
  hcp: "🏠 HCP email",
  text: "💬 Text",
  campaign: "📣 Campaign",
  test: "🧪 Test",
};

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function SendsLedger({ rows }: { rows: LedgerRow[] }) {
  const [lane, setLane] = useState<LedgerRow["lane"] | "all">("all");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    let out = lane === "all" ? rows : rows.filter((r) => r.lane === lane);
    const needle = q.trim().toLowerCase();
    if (needle) {
      out = out.filter((r) =>
        r.who.toLowerCase().includes(needle) || r.detail.toLowerCase().includes(needle),
      );
    }
    return out;
  }, [rows, lane, q]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customer, email, phone…"
          className="w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5">
          {LANES.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLane(l.key)}
              className={`rounded px-2 py-1 text-xs font-medium ${lane === l.key ? "bg-brand-100 text-brand-900" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-neutral-500">{visible.length} of {rows.length}</span>
      </div>

      <div className="overflow-hidden rounded-2xl border-2 border-neutral-300 bg-white shadow-sm">
        {visible.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">Nothing matches.</div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {visible.map((r, i) => {
              const inner = (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
                  <span className="w-32 shrink-0 text-xs tabular-nums text-neutral-500">{fmtTs(r.ts)}</span>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                    r.lane === "test" ? "bg-neutral-100 text-neutral-500 ring-neutral-200" : "bg-brand-50 text-brand-800 ring-brand-200"
                  }`}>
                    {LANE_BADGE[r.lane]}
                  </span>
                  <span className="min-w-0 font-medium text-neutral-900">{r.who}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-600">{r.detail}</span>
                  {r.status ? (
                    <span className={`shrink-0 text-xs font-semibold ${
                      r.statusTone === "good" ? "text-emerald-700"
                      : r.statusTone === "bad" ? "text-red-600"
                      : r.statusTone === "ok" ? "text-neutral-600"
                      : "text-neutral-400"
                    }`}>
                      {r.status}
                    </span>
                  ) : null}
                </div>
              );
              return (
                <li key={i} className={r.lane === "test" ? "opacity-70" : ""}>
                  {r.href ? (
                    <Link href={r.href} className="block transition hover:bg-brand-50/40">{inner}</Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
