"use client";

// Client-side estimates table with sort, search, and fixed column widths so
// rows line up cleanly (the previous Table used auto widths so cells drifted
// row to row depending on content). Every row links to /estimate/[id], no
// longer gated on hcp_job_id presence.

import { useMemo, useState } from "react";
import Link from "next/link";

export type EstimateRow = {
  id: string;
  project_name: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  hcp_job_id: string | null;
  hcp_estimate_id: string | null;
  hcp_estimate_number: string | null;
  status: string | null;
  source: string | null;
  created_at: string;
  hcp_pushed_at: string | null;
  customer_approved_at: string | null;
  tech_authorized_at: string | null;
  created_by: string | null;
};

type SortKey = "created_at" | "status" | "customer_name" | "project_name" | "hcp_estimate_number" | "created_by" | "customer_approved_at";
type SortDir = "asc" | "desc";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-neutral-400">—</span>;
  const tone =
    status === "approved" || status === "pushed" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : status === "preview" ? "bg-brand-50 text-brand-800 ring-brand-200"
    : status === "archived" ? "bg-neutral-100 text-neutral-600 ring-neutral-300"
    : "bg-neutral-50 text-neutral-700 ring-neutral-200";
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone}`}>
      {status}
    </span>
  );
}

function rowMatchesSearch(r: EstimateRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const haystacks = [
    r.customer_name, r.project_name, r.hcp_estimate_number, r.status,
    r.created_by, r.hcp_customer_id, r.hcp_job_id,
  ];
  return haystacks.some((v) => v != null && v.toLowerCase().includes(needle));
}

function compare(a: EstimateRow, b: EstimateRow, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  // Nulls last on asc, first on desc — easier mental model.
  if (av == null && bv == null) return 0;
  if (av == null) return dir === "asc" ? 1 : -1;
  if (bv == null) return dir === "asc" ? -1 : 1;
  if (key === "created_at" || key === "customer_approved_at") {
    const ax = new Date(String(av)).getTime();
    const bx = new Date(String(bv)).getTime();
    return dir === "asc" ? ax - bx : bx - ax;
  }
  const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
  return dir === "asc" ? cmp : -cmp;
}

const COLS: Array<{ key: SortKey; label: string; widthClass: string; align?: "left" | "right" }> = [
  { key: "created_at", label: "Created", widthClass: "w-[80px]" },
  { key: "status", label: "Status", widthClass: "w-[100px]" },
  { key: "customer_name", label: "Customer", widthClass: "w-[200px]" },
  { key: "project_name", label: "Project", widthClass: "w-auto" },
  { key: "hcp_estimate_number", label: "HCP estimate", widthClass: "w-[140px]" },
  { key: "created_by", label: "By", widthClass: "w-[120px]" },
  { key: "customer_approved_at", label: "Approved", widthClass: "w-[100px]" },
];

export function EstimatesTable({ rows: initialRows, aiIds = [] }: { rows: EstimateRow[]; aiIds?: string[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const aiSet = useMemo(() => new Set(aiIds), [aiIds]);

  const visible = useMemo(() => {
    const filtered = query ? initialRows.filter((r) => rowMatchesSearch(r, query)) : initialRows;
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [initialRows, query, sortKey, sortDir]);

  function onHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "created_at" || key === "customer_approved_at" ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortKey !== key) return <span className="ml-0.5 text-neutral-300">↕</span>;
    return <span className="ml-0.5 text-neutral-700">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer, project, HCP #, status, by…"
          className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-navy-700 focus:outline-none"
        />
        <span className="text-xs text-neutral-500">
          {visible.length} of {initialRows.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {COLS.map((c) => (
              <col key={c.key} className={c.widthClass} />
            ))}
          </colgroup>
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-neutral-600 hover:text-neutral-900"
                  onClick={() => onHeader(c.key)}
                >
                  <span className="inline-flex items-center">
                    {c.label}
                    {arrow(c.key)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-6 text-center text-sm text-neutral-500">
                  {query ? `No estimates match "${query}".` : "No estimates."}
                </td>
              </tr>
            ) : visible.map((r) => (
              <tr key={r.id} className="cursor-pointer transition hover:bg-neutral-50">
                <td className="truncate px-3 py-2 text-neutral-600">
                  <Link href={`/estimate/${r.id}`} className="block">{fmtDate(r.created_at)}</Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/estimate/${r.id}`} className="block"><StatusPill status={r.status} /></Link>
                </td>
                <td className="truncate px-3 py-2">
                  {r.hcp_customer_id ? (
                    <Link href={`/customer/${r.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                      {r.customer_name ?? "—"}
                    </Link>
                  ) : (
                    <Link href={`/estimate/${r.id}`} className="block font-medium text-neutral-900">{r.customer_name ?? "—"}</Link>
                  )}
                </td>
                <td className="truncate px-3 py-2 text-xs text-neutral-700">
                  {aiSet.has(r.id) ? (
                    <Link href={`/estimate/${r.id}/review`} className="flex items-center gap-1.5 truncate">
                      <span className="shrink-0 rounded-sm bg-brand-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-inset ring-brand-200" title="Built by the estimate-from-conversation AI — click to review">
                        AI
                      </span>
                      <span className="truncate">{r.project_name ?? "—"}</span>
                    </Link>
                  ) : (
                    <Link href={`/estimate/${r.id}`} className="block truncate">{r.project_name ?? "—"}</Link>
                  )}
                </td>
                <td className="truncate px-3 py-2">
                  <Link href={`/estimate/${r.id}`} className="block font-mono text-xs">
                    {r.hcp_estimate_number ? `#${r.hcp_estimate_number}` : <span className="text-neutral-400">—</span>}
                  </Link>
                </td>
                <td className="truncate px-3 py-2 text-neutral-600">
                  <Link href={`/estimate/${r.id}`} className="block">{r.created_by ?? "—"}</Link>
                </td>
                <td className="truncate px-3 py-2">
                  <Link href={`/estimate/${r.id}`} className="block">
                    {r.customer_approved_at ? (
                      <span className="text-emerald-700">{fmtDate(r.customer_approved_at)}</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
