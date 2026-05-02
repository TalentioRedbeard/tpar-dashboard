// Generic table primitive for list pages. Server-renders rows; relies on
// the URL query string for filtering + pagination so each page is a real
// linkable URL.
//
// Visual: sticky header on long lists, subtle alternating row backgrounds,
// brand-tinted hover, slightly more spacious row padding. Whole-row links
// use a grid overlay so the entire row is clickable + keyboard-navigable.

import Link from "next/link";
import type { ReactNode } from "react";

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
};

export function Table<T>({
  columns,
  rows,
  rowHref,
  emptyText = "No results.",
}: {
  columns: Column<T>[];
  rows: T[];
  rowHref?: (row: T) => string | null | undefined;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-10 text-center">
        <div className="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm text-neutral-500">{emptyText}</p>
      </div>
    );
  }

  const alignClass = (a?: "left" | "right" | "center") =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/95 backdrop-blur supports-[backdrop-filter]:bg-neutral-50/85">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-4 py-2.5 ${alignClass(c.align)} text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-600 ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((row, rIdx) => {
            const href = rowHref?.(row);
            const zebra = rIdx % 2 === 0 ? "" : "bg-neutral-50/40";
            const cells = columns.map((c, cIdx) => (
              <td
                key={cIdx}
                className={`px-4 py-2.5 align-top ${alignClass(c.align)} ${c.className ?? ""}`}
              >
                {c.cell(row)}
              </td>
            ));
            if (href) {
              return (
                <tr key={rIdx} className={`group transition-colors hover:bg-brand-50/40 ${zebra}`}>
                  <td colSpan={columns.length} className="p-0">
                    <Link
                      href={href}
                      className="grid w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                      style={{ gridTemplateColumns: columns.map(() => "1fr").join(" ") }}
                    >
                      {columns.map((c, cIdx) => (
                        <span
                          key={cIdx}
                          className={`px-4 py-2.5 ${alignClass(c.align)} ${c.className ?? ""}`}
                        >
                          {c.cell(row)}
                        </span>
                      ))}
                    </Link>
                  </td>
                </tr>
              );
            }
            return <tr key={rIdx} className={`transition-colors hover:bg-brand-50/40 ${zebra}`}>{cells}</tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  totalCount,
  baseHref,
}: {
  page: number;
  pageSize: number;
  totalCount: number | null;
  baseHref: string;
}) {
  const hasPrev = page > 1;
  const hasNext = totalCount === null || page * pageSize < totalCount;
  const totalPages = totalCount !== null ? Math.max(1, Math.ceil(totalCount / pageSize)) : null;
  const sep = baseHref.includes("?") ? "&" : "?";
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
      <div className="tabular-nums">
        {totalCount !== null
          ? <>Showing <span className="font-medium text-neutral-800">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)}</span> of <span className="font-medium text-neutral-800">{totalCount.toLocaleString()}</span></>
          : <>Page {page}</>}
      </div>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={`${baseHref}${sep}page=${page - 1}`}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1 font-medium text-neutral-700 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-700"
            prefetch={false}
          >
            <span aria-hidden>←</span> Prev
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1 text-neutral-300">
            <span aria-hidden>←</span> Prev
          </span>
        )}
        {hasNext ? (
          <Link
            href={`${baseHref}${sep}page=${page + 1}`}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1 font-medium text-neutral-700 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-700"
            prefetch={false}
          >
            Next <span aria-hidden>→</span>
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1 text-neutral-300">
            Next <span aria-hidden>→</span>
          </span>
        )}
        {totalPages ? <span className="ml-1 tabular-nums text-neutral-400">of {totalPages}</span> : null}
      </div>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <form
      className="mb-5 rounded-2xl border border-neutral-200 bg-gradient-to-br from-neutral-50/80 to-white px-4 py-3 shadow-sm"
      role="search"
    >
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </form>
  );
}

export function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export function fmtDateShort(s: unknown): string {
  if (!s) return "—";
  try {
    return new Date(s as string).toLocaleDateString("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(s);
  }
}

export function fmtPct(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(0)}%` : "—";
}

/**
 * Status pill with predefined tones. Drop into table cells where you'd
 * otherwise render a raw status string.
 */
export function StatusPill({
  status,
  tone,
}: {
  status: string;
  tone?: "neutral" | "green" | "amber" | "red" | "brand" | "slate";
}) {
  const toneCls: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200",
    green:   "bg-emerald-100 text-emerald-800 ring-emerald-200",
    amber:   "bg-amber-100 text-amber-800 ring-amber-200",
    red:     "bg-red-100 text-red-800 ring-red-200",
    brand:   "bg-brand-100 text-brand-800 ring-brand-200",
    slate:   "bg-slate-100 text-slate-700 ring-slate-200",
  };
  const cls = toneCls[tone ?? autoToneFromStatus(status)] ?? toneCls.neutral;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  );
}

function autoToneFromStatus(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete")) return "green";
  if (s.includes("scheduled") || s.includes("active")) return "brand";
  if (s.includes("progress")) return "amber";
  if (s.includes("cancel") || s.includes("fail")) return "red";
  return "neutral";
}
