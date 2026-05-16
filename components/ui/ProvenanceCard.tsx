// Per-record lineage card. Answers "where did this data come from?"
// without having to grep code or trace webhooks. Drops at the bottom of
// any 360-style page (/customer/{id}, /job/{id}, /comms/{id}).
//
// Each item:
//   - section: the visual block on the page this row provenances
//   - source_fn: the edge function (or "dashboard" / "manual") that wrote
//     the underlying row. Renders as a link to /admin/system anchored
//     to the function row.
//   - tables: the tables in our DB where the rows live.
//   - last_ts: the timestamp of the most recent row (so freshness is visible).
//   - count: how many rows back this section. Optional.
//   - tone: optional pill tone for the freshness signal.

import Link from "next/link";

export type ProvenanceItem = {
  section: string;
  source_fn: string | null;       // 'hcp-webhook' | 'build-customer-card' | 'dashboard' | null
  tables: string[];
  last_ts: string | null;
  count?: number;
  note?: string;                  // extra inline detail e.g. "card not yet built"
};

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" });
}

export function ProvenanceCard({ items, title = "Provenance" }: { items: ProvenanceItem[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <summary className="cursor-pointer text-xs font-medium text-neutral-600 hover:text-neutral-900">
        {title} <span className="text-neutral-400">({items.length} feeders)</span>
      </summary>
      <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-xs">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium text-neutral-600">Section</th>
              <th className="px-3 py-1.5 text-left font-medium text-neutral-600">Source</th>
              <th className="px-3 py-1.5 text-left font-medium text-neutral-600">Tables</th>
              <th className="px-3 py-1.5 text-right font-medium text-neutral-600">Rows</th>
              <th className="px-3 py-1.5 text-left font-medium text-neutral-600">Last row</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((i) => (
              <tr key={i.section} className="hover:bg-neutral-50">
                <td className="px-3 py-1.5 text-neutral-800">
                  {i.section}
                  {i.note ? <span className="ml-1 text-neutral-400">— {i.note}</span> : null}
                </td>
                <td className="px-3 py-1.5 font-mono text-neutral-700">
                  {i.source_fn ? (
                    <Link href={`/admin/system#${i.source_fn}`} className="hover:underline">{i.source_fn}</Link>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {i.tables.map((t) => (
                      <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-700">{i.count ?? "—"}</td>
                <td className="px-3 py-1.5 font-mono text-neutral-500">{fmtTs(i.last_ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
