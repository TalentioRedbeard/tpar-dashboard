"use client";

// Client-side communications-history table for the customer page. Sortable
// columns + search + CSV export so leadership can pull a client's full call/text
// history when compiling a report or estimate. Mirrors EstimatesTable's
// self-contained sort/search pattern (no shared-UI imports) and reuses the
// AskResult CSV builder (RFC-4180 + Excel BOM) inline since it isn't exported.
// Replaces the old "Recent communications" card list — strictly more for the
// report use case (more rows, sortable, exportable) at the same page visibility.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export type CommRow = {
  id: number | string;
  occurred_at: string;
  channel: string | null;
  direction: string | null;
  importance: number | null;
  sentiment: string | null;
  tech_short_name: string | null;
  summary: string | null;
};

type SortKey = "occurred_at" | "channel" | "direction" | "tech" | "importance" | "sentiment";
type SortDir = "asc" | "desc";

// "5/13/26, 9:57 AM" in Tulsa time — deterministic across SSR/client (explicit
// tz + locale) so there's no hydration mismatch.
function fmtWhen(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "numeric", day: "numeric", year: "2-digit",
    hour: "numeric", minute: "2-digit",
  });
}

function Tag({ children, tone }: { children: ReactNode; tone: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone}`}>
      {children}
    </span>
  );
}

function channelTone(ch: string | null): string {
  if (ch === "call") return "bg-brand-50 text-brand-800 ring-brand-200";
  if (ch === "text") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  return "bg-neutral-100 text-neutral-600 ring-neutral-300";
}
function directionTone(d: string | null): string {
  if (d === "internal") return "bg-violet-50 text-violet-800 ring-violet-200";
  if (d === "inbound") return "bg-sky-50 text-sky-800 ring-sky-200";
  if (d === "outbound") return "bg-neutral-50 text-neutral-700 ring-neutral-200";
  return "bg-neutral-100 text-neutral-500 ring-neutral-200";
}
function sentimentTone(s: string | null): string {
  if (s === "positive") return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  if (s === "negative") return "bg-red-100 text-red-800 ring-red-200";
  return "bg-neutral-100 text-neutral-700 ring-neutral-200";
}

// --- CSV export (client-side; mirrors AskResult.tsx) ---
function csvCell(v: unknown): string {
  let s: string;
  if (v == null) s = "";
  else if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else if (typeof v === "string") s = v;
  else { try { s = JSON.stringify(v); } catch { s = String(v); } }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv(rows: Record<string, unknown>[], cols: string[]): string {
  const head = cols.map(csvCell).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(","));
  return [head, ...body].join("\r\n");
}
function slugify(s: string): string {
  return (s || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "customer";
}
function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getVal(r: CommRow, key: SortKey): string | number | null {
  switch (key) {
    case "occurred_at": return r.occurred_at;
    case "channel": return r.channel;
    case "direction": return r.direction;
    case "tech": return r.tech_short_name;
    case "importance": return r.importance;
    case "sentiment": return r.sentiment;
  }
}

function compare(a: CommRow, b: CommRow, key: SortKey, dir: SortDir): number {
  const av = getVal(a, key);
  const bv = getVal(b, key);
  // Nulls last on asc, first on desc.
  if (av == null && bv == null) return 0;
  if (av == null) return dir === "asc" ? 1 : -1;
  if (bv == null) return dir === "asc" ? -1 : 1;
  if (key === "occurred_at") {
    const ax = new Date(String(av)).getTime();
    const bx = new Date(String(bv)).getTime();
    return dir === "asc" ? ax - bx : bx - ax;
  }
  if (key === "importance") {
    const d = Number(av) - Number(bv);
    return dir === "asc" ? d : -d;
  }
  const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
  return dir === "asc" ? cmp : -cmp;
}

function rowMatchesSearch(r: CommRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [r.channel, r.direction, r.tech_short_name, r.sentiment, r.summary];
  return hay.some((v) => v != null && v.toLowerCase().includes(needle));
}

const COLS: Array<{ key: SortKey; label: string; align?: "left" | "right" }> = [
  { key: "occurred_at", label: "When" },
  { key: "channel", label: "Channel" },
  { key: "direction", label: "Dir" },
  { key: "tech", label: "Who" },
  { key: "importance", label: "Imp", align: "right" },
  { key: "sentiment", label: "Sentiment" },
];

export function CommHistoryTable({ rows, customerName, truncated }: { rows: CommRow[]; customerName?: string; truncated?: boolean }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("occurred_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const visible = useMemo(() => {
    const filtered = query ? rows.filter((r) => rowMatchesSearch(r, query)) : rows;
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [rows, query, sortKey, sortDir]);

  function onHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric/date columns are most useful high-first.
      setSortDir(key === "occurred_at" || key === "importance" ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortKey !== key) return <span className="ml-0.5 text-neutral-300">↕</span>;
    return <span className="ml-0.5 text-neutral-700">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function exportCsv() {
    const cols = ["when_cst", "channel", "direction", "tech", "importance", "sentiment", "summary"];
    const recs = visible.map((r) => ({
      when_cst: fmtWhen(r.occurred_at),
      channel: r.channel ?? "",
      direction: r.direction ?? "",
      tech: r.tech_short_name ?? "",
      importance: r.importance ?? "",
      sentiment: r.sentiment ?? "",
      summary: r.summary ?? "",
    }));
    downloadCsv(`comm-history-${slugify(customerName ?? "customer")}.csv`, buildCsv(recs, cols));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search summary, channel, who, sentiment…"
          className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-navy-700 focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500">{visible.length} of {rows.length}</span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            ⬇ CSV
          </button>
        </div>
      </div>

      {truncated ? (
        <p className="mb-2 text-[11px] text-amber-700">
          Showing the most recent 500 communications — older entries aren&apos;t loaded here.
        </p>
      ) : null}

      <div className="max-h-[60vh] overflow-auto rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50">
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-600 hover:text-neutral-900 ${c.align === "right" ? "text-right" : "text-left"}`}
                  onClick={() => onHeader(c.key)}
                >
                  <span className="inline-flex items-center">
                    {c.label}
                    {arrow(c.key)}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-neutral-600">
                Summary
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 1} className="px-3 py-6 text-center text-sm text-neutral-500">
                  {query ? `No communications match "${query}".` : "No communications."}
                </td>
              </tr>
            ) : visible.map((r) => (
              <tr key={r.id} className="align-top hover:bg-neutral-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-600">{fmtWhen(r.occurred_at)}</td>
                <td className="px-3 py-2">{r.channel ? <Tag tone={channelTone(r.channel)}>{r.channel}</Tag> : <span className="text-neutral-400">—</span>}</td>
                <td className="px-3 py-2">{r.direction ? <Tag tone={directionTone(r.direction)}>{r.direction}</Tag> : <span className="text-neutral-400">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-700">{r.tech_short_name ?? <span className="text-neutral-400">—</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                  {r.importance != null ? (
                    <span className={Number(r.importance) >= 7 ? "font-medium text-amber-700" : ""}>{r.importance}</span>
                  ) : <span className="text-neutral-400">—</span>}
                </td>
                <td className="px-3 py-2">{r.sentiment ? <Tag tone={sentimentTone(r.sentiment)}>{r.sentiment}</Tag> : <span className="text-neutral-400">—</span>}</td>
                <td className="px-3 py-2 text-neutral-800">{r.summary ?? <span className="text-neutral-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
