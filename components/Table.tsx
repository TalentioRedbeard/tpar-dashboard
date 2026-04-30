// Generic table primitive for list pages. Server-renders rows; relies on
// the URL query string for filtering + pagination so each page is a real
// linkable URL.

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
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-4 py-2 text-${c.align ?? "left"} font-medium text-neutral-600 ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((row, rIdx) => {
            const href = rowHref?.(row);
            const cells = columns.map((c, cIdx) => (
              <td
                key={cIdx}
                className={`px-4 py-2 align-top text-${c.align ?? "left"} ${c.className ?? ""}`}
              >
                {c.cell(row)}
              </td>
            ));
            if (href) {
              // Whole-row link: wrap in a tr that on click navigates. We use
              // a Link inside the first cell as the accessibility primitive
              // and overlay style on the row.
              return (
                <tr key={rIdx} className="group hover:bg-neutral-50">
                  <td colSpan={columns.length} className="p-0">
                    <Link href={href} className="grid w-full" style={{ gridTemplateColumns: columns.map(() => "1fr").join(" ") }}>
                      {columns.map((c, cIdx) => (
                        <span
                          key={cIdx}
                          className={`px-4 py-2 text-${c.align ?? "left"} ${c.className ?? ""}`}
                        >
                          {c.cell(row)}
                        </span>
                      ))}
                    </Link>
                  </td>
                </tr>
              );
            }
            return <tr key={rIdx} className="hover:bg-neutral-50">{cells}</tr>;
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
    <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
      <div>
        {totalCount !== null
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} of ${totalCount}`
          : `Page ${page}`}
      </div>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={`${baseHref}${sep}page=${page - 1}`}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-50"
            prefetch={false}
          >
            ← Prev
          </Link>
        ) : null}
        {hasNext ? (
          <Link
            href={`${baseHref}${sep}page=${page + 1}`}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-50"
            prefetch={false}
          >
            Next →
          </Link>
        ) : null}
        {totalPages ? <span className="ml-2">of {totalPages}</span> : null}
      </div>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
      {children}
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
