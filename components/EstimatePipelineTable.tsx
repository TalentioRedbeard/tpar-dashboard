"use client";

// Sent-estimate pipeline table (reads estimate_pipeline_v). Sort + search + fixed
// column widths, same feel as the old builder EstimatesTable. Each row links to the
// in-app estimate page; AI-built rows deep-link to the builder review surface.
// Managers/admins additionally get batch send: select rows → send to customers
// (per-estimate guardrails in the edge fn) or send the whole batch as [TEST]
// emails to their own inbox (kind='test' — invisible to the pipeline).

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { batchSendEstimates, type BatchItemResult } from "../app/estimates/batch-actions";

export type PipelineRow = {
  hcp_estimate_id: string;
  hcp_customer_id: string | null;
  customer_name: string | null;
  estimate_number: string | null;
  stage: string | null;
  total_dollars: number | string | null;
  min_dollars: number | string | null;
  option_count: number | null;
  created_at: string | null;
  last_activity: string | null;
  age_days: number | null;
  is_ai_built: boolean | null;
  bid_estimate_id: string | null;
  hcp_url: string | null;
};

type SortKey = "last_activity" | "stage" | "customer_name" | "estimate_number" | "total_dollars" | "age_days";
type SortDir = "asc" | "desc";

function fmtMoney(row: PipelineRow): string {
  const max = row.total_dollars == null ? null : Number(row.total_dollars);
  const min = row.min_dollars == null ? null : Number(row.min_dollars);
  if (max == null || !Number.isFinite(max)) return "—";
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  // Range when there's more than one (mutually-exclusive) option and the ends differ.
  if ((row.option_count ?? 0) > 1 && min != null && Number.isFinite(min) && min !== max) {
    return `${fmt(min)}–${fmt(max)}`;
  }
  return fmt(max);
}

function fmtAge(days: number | null): string {
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

function StagePill({ stage }: { stage: string | null }) {
  const s = (stage ?? "awaiting").toLowerCase();
  const tone =
    s === "won" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : s === "awaiting" ? "bg-brand-50 text-brand-800 ring-brand-200"
    : s === "declined" ? "bg-amber-50 text-amber-800 ring-amber-200"
    : "bg-neutral-100 text-neutral-600 ring-neutral-300";
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset ${tone}`}>
      {s}
    </span>
  );
}

function summarizeSkips(skipped: BatchItemResult[]): string {
  const counts = new Map<string, number>();
  for (const s of skipped) {
    const key = s.error?.startsWith("no_recipient_email")
      ? "no email on file"
      : s.error?.startsWith("estimate_terminal_state")
        ? "already decided in HCP"
        : s.error?.startsWith("hcp_state_unavailable")
          ? "HCP unreachable"
          : "error";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k} ×${n}`).join(", ");
}

function rowMatchesSearch(r: PipelineRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const haystacks = [r.customer_name, r.estimate_number, r.stage, r.hcp_customer_id];
  return haystacks.some((v) => v != null && String(v).toLowerCase().includes(needle));
}

function compare(a: PipelineRow, b: PipelineRow, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return dir === "asc" ? 1 : -1;
  if (bv == null) return dir === "asc" ? -1 : 1;
  if (key === "last_activity") {
    const ax = new Date(String(av)).getTime();
    const bx = new Date(String(bv)).getTime();
    return dir === "asc" ? ax - bx : bx - ax;
  }
  if (key === "total_dollars" || key === "age_days") {
    const ax = Number(av);
    const bx = Number(bv);
    return dir === "asc" ? ax - bx : bx - ax;
  }
  const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
  return dir === "asc" ? cmp : -cmp;
}

const COLS: Array<{ key: SortKey; label: string; widthClass: string; align?: "left" | "right" }> = [
  { key: "estimate_number", label: "Estimate", widthClass: "w-[120px]" },
  { key: "stage", label: "Stage", widthClass: "w-[110px]" },
  { key: "customer_name", label: "Customer", widthClass: "w-auto" },
  { key: "total_dollars", label: "Amount", widthClass: "w-[150px]", align: "right" },
  { key: "age_days", label: "Age", widthClass: "w-[80px]", align: "right" },
];

export function EstimatePipelineTable({
  rows: initialRows,
  canBatchSend = false,
  meEmail = null,
}: {
  rows: PipelineRow[];
  canBatchSend?: boolean;
  meEmail?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("last_activity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [testEmail, setTestEmail] = useState(meEmail ?? "");
  const [confirming, setConfirming] = useState<"customers" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Map<string, BatchItemResult>>(new Map());
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const visible = useMemo(() => {
    let filtered = stageFilter === "all" ? initialRows : initialRows.filter((r) => (r.stage ?? "") === stageFilter);
    if (query) filtered = filtered.filter((r) => rowMatchesSearch(r, query));
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [initialRows, query, stageFilter, sortKey, sortDir]);

  function onHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "last_activity" || key === "total_dollars" || key === "age_days" ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortKey !== key) return <span className="ml-0.5 text-neutral-300">↕</span>;
    return <span className="ml-0.5 text-neutral-700">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const STAGES = ["all", "awaiting", "won", "declined", "expired"] as const;

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.hcp_estimate_id));
  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      return new Set([...prev, ...visible.map((r) => r.hcp_estimate_id)]);
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Chunked sequential batch: ≤10 per server-action call, live progress,
  // per-row outcomes kept so skips (no email, already decided) are visible.
  function runBatch(test: boolean) {
    const ids = [...selected];
    if (ids.length === 0 || pending) return;
    setConfirming(null);
    setBatchNote(null);
    setOutcomes(new Map());
    setProgress({ done: 0, total: ids.length });
    startTransition(async () => {
      const all = new Map<string, BatchItemResult>();
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const res = await batchSendEstimates({ ids: chunk, test, toEmail: test ? testEmail.trim() : undefined });
        if (!res.ok) {
          setBatchNote(res.error);
          break;
        }
        for (const r of res.results) all.set(r.id, r);
        setOutcomes(new Map(all));
        setProgress({ done: Math.min(i + 10, ids.length), total: ids.length });
      }
      const done = [...all.values()];
      const sent = done.filter((r) => r.ok && !r.deduped).length;
      const skipped = done.filter((r) => !r.ok);
      setBatchNote(
        `${sent} sent${test ? ` as [TEST] to ${testEmail.trim()}` : ""}` +
          (skipped.length ? ` · ${skipped.length} skipped (${summarizeSkips(skipped)})` : ""),
      );
      setProgress(null);
      if (!test) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, estimate #, stage…"
            className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-navy-700 focus:outline-none"
          />
          <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5">
            {STAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStageFilter(s)}
                className={`rounded px-2 py-1 text-xs font-medium capitalize ${stageFilter === s ? "bg-brand-100 text-brand-900" : "text-neutral-600 hover:bg-neutral-100"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <span className="text-xs text-neutral-500">
          {visible.length} of {initialRows.length}
        </span>
      </div>

      {canBatchSend && selected.size > 0 ? (
        <div className="mb-3 rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-900">{selected.size} selected</span>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="staff inbox for the test"
              className="w-56 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={pending || !testEmail.trim()}
              onClick={() => runBatch(true)}
              className="rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-40"
            >
              🧪 Send batch as [TEST] to me
            </button>
            {confirming === "customers" ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-neutral-700">
                  Each goes to the email on its HCP record; no-email or already-decided estimates are skipped and
                  reported. This cannot be unsent.
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => runBatch(false)}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
                >
                  Yes — send {selected.size} to customers
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="text-sm text-neutral-500 hover:text-neutral-700">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming("customers")}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
              >
                📤 Send {selected.size} to customers…
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => { setSelected(new Set()); setOutcomes(new Map()); setBatchNote(null); }}
              className="ml-auto text-xs text-neutral-500 hover:text-neutral-700"
            >
              clear selection
            </button>
          </div>
          {progress ? (
            <div className="mt-2 text-xs font-medium text-brand-800">Sending… {progress.done}/{progress.total}</div>
          ) : null}
          {batchNote ? <div className="mt-2 text-xs font-medium text-neutral-700">{batchNote}</div> : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border-2 border-neutral-400 bg-white shadow-sm">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {canBatchSend ? <col className="w-[40px]" /> : null}
            {COLS.map((c) => (
              <col key={c.key} className={c.widthClass} />
            ))}
          </colgroup>
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              {canBatchSend ? (
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    title="Select everything currently shown (respects search + stage filter)"
                    className="h-4 w-4 accent-brand-700"
                  />
                </th>
              ) : null}
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-600 hover:text-neutral-900 ${c.align === "right" ? "text-right" : "text-left"}`}
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
                <td colSpan={COLS.length + (canBatchSend ? 1 : 0)} className="px-3 py-6 text-center text-sm text-neutral-500">
                  {query || stageFilter !== "all" ? "No estimates match." : "No estimates."}
                </td>
              </tr>
            ) : visible.map((r, i) => {
              // AI-built rows deep-link to the builder review surface; everything
              // else opens the in-app estimate page (layout-B template, 2026-07-13
              // — Danny's pick), which carries its own "Open in HCP" button.
              const href = r.is_ai_built && r.bid_estimate_id
                ? `/estimate/${r.bid_estimate_id}`
                : `/estimate/${r.hcp_estimate_id}`;
              const external = false;
              // Padding lives on the ANCHORS, not the tds, so the whole row is
              // an honest click target with no dead zones between cells
              // (tablet-primary; click-bug fix 2026-07-13). The customer cell
              // keeps its own deliberate secondary link to /customer/[id].
              const cell = (children: ReactNode, extra = "") =>
                external ? (
                  <a href={href} target="_blank" rel="noreferrer" className={`block px-3 py-2 ${extra}`}>{children}</a>
                ) : (
                  <Link href={href} className={`block px-3 py-2 ${extra}`}>{children}</Link>
                );
              const outcome = outcomes.get(r.hcp_estimate_id);
              return (
                <tr key={r.hcp_estimate_id} className={`cursor-pointer transition hover:bg-brand-50/40 ${i % 2 === 0 ? "bg-white" : "bg-neutral-100"}`}>
                  {canBatchSend ? (
                    <td className="px-2 py-2 text-center">
                      {outcome ? (
                        <span title={outcome.ok ? (outcome.deduped ? "already in flight — deduped" : "sent") : outcome.error}>
                          {outcome.ok ? "✅" : "⚠️"}
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={selected.has(r.hcp_estimate_id)}
                          onChange={() => toggleOne(r.hcp_estimate_id)}
                          className="h-4 w-4 accent-brand-700"
                        />
                      )}
                    </td>
                  ) : null}
                  <td className="truncate p-0">
                    {cell(
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        {r.is_ai_built ? (
                          <span className="shrink-0 rounded-sm bg-brand-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-inset ring-brand-200" title="Built by the estimate AI — opens the builder">AI</span>
                        ) : null}
                        {r.estimate_number ? `#${r.estimate_number}` : <span className="text-neutral-400">—</span>}
                      </span>,
                    )}
                  </td>
                  <td className="p-0">{cell(<StagePill stage={r.stage} />)}</td>
                  <td className="truncate p-0">
                    {r.hcp_customer_id ? (
                      <Link href={`/customer/${r.hcp_customer_id}`} className="block truncate px-3 py-2 font-medium text-neutral-900 hover:underline">
                        {r.customer_name ?? "—"}
                      </Link>
                    ) : (
                      cell(<span className="font-medium text-neutral-900">{r.customer_name ?? "—"}</span>)
                    )}
                  </td>
                  <td className="truncate p-0 text-right font-medium text-neutral-900">{cell(<span>{fmtMoney(r)}</span>, "text-right")}</td>
                  <td className="truncate p-0 text-right text-neutral-600">{cell(<span>{fmtAge(r.age_days)}</span>, "text-right")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
