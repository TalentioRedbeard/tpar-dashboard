// Materials assessment v0 — vendor-spend trend.
//
// Source: vendor_spend_weekly_v (receipts_master rolled up by normalized
// vendor key). v0 surfaces drift; doesn't pretend to be inventory tracking
// (which needs job-side outflow tagging) or item-level cost variance (which
// needs receipt-line → pricebook mapping).

import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";

export const metadata = { title: "Material spend · TPAR-DB" };

const WEEKS = 12;

type WeekRow = {
  vendor_key: string;
  week_start: string;
  receipt_count: number;
  total_spend: string | number;
};

export default async function MaterialSpendReport() {
  const supa = db();
  // Last 12 weeks of vendor activity
  const sinceIso = new Date(Date.now() - WEEKS * 7 * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supa
    .from("vendor_spend_weekly_v")
    .select("*")
    .gte("week_start", sinceIso)
    .order("week_start", { ascending: false });
  const rows = (data ?? []) as WeekRow[];

  // Aggregate per vendor across the window
  const perVendor = new Map<string, { total: number; receipts: number; weekly: Map<string, number> }>();
  for (const r of rows) {
    const v = r.vendor_key;
    const amt = Number(r.total_spend) || 0;
    const cur = perVendor.get(v) ?? { total: 0, receipts: 0, weekly: new Map<string, number>() };
    cur.total += amt;
    cur.receipts += r.receipt_count;
    cur.weekly.set(r.week_start, amt);
    perVendor.set(v, cur);
  }
  const sortedVendors = [...perVendor.entries()]
    .map(([vendor, agg]) => ({ vendor, ...agg }))
    .sort((a, b) => b.total - a.total);

  // Build the week column header list (most recent first)
  const allWeeks = [...new Set(rows.map((r) => r.week_start))].sort().reverse();

  // Trend signal: last 4 weeks avg vs prior 4 weeks avg, per vendor
  const recent = allWeeks.slice(0, 4);
  const prior = allWeeks.slice(4, 8);
  function avgFor(vendor: string, weeks: string[]): number {
    const v = perVendor.get(vendor);
    if (!v || weeks.length === 0) return 0;
    let sum = 0;
    for (const w of weeks) sum += v.weekly.get(w) ?? 0;
    return sum / weeks.length;
  }

  const totalSpend = sortedVendors.reduce((s, v) => s + v.total, 0);
  const totalReceipts = sortedVendors.reduce((s, v) => s + v.receipts, 0);

  return (
    <PageShell
      title="Material spend"
      description={`Last ${WEEKS} weeks · ${sortedVendors.length} vendors · $${Math.round(totalSpend).toLocaleString()} across ${totalReceipts} receipts. Drift signal: 4-week recent vs prior. v0 — full inventory + item-level variance deferred.`}
    >
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to load: {error.message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-right">Total ({WEEKS}w)</th>
              <th className="px-3 py-2 text-right">Receipts</th>
              <th className="px-3 py-2 text-right">Avg/recpt</th>
              <th className="px-3 py-2 text-right">Recent 4w avg/wk</th>
              <th className="px-3 py-2 text-right">Prior 4w avg/wk</th>
              <th className="px-3 py-2 text-right">Drift</th>
            </tr>
          </thead>
          <tbody>
            {sortedVendors.map((v) => {
              const recentAvg = avgFor(v.vendor, recent);
              const priorAvg = avgFor(v.vendor, prior);
              const drift = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : null;
              const driftClass =
                drift == null
                  ? "text-neutral-400"
                  : drift > 30
                  ? "text-red-700 font-medium"
                  : drift > 10
                  ? "text-amber-700"
                  : drift < -30
                  ? "text-emerald-700 font-medium"
                  : "text-neutral-600";
              return (
                <tr key={v.vendor} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-medium text-neutral-900">{v.vendor}</td>
                  <td className="px-3 py-2 text-right">${Math.round(v.total).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-neutral-600">{v.receipts}</td>
                  <td className="px-3 py-2 text-right text-neutral-600">${(v.total / Math.max(1, v.receipts)).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">${Math.round(recentAvg).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-neutral-600">${Math.round(priorAvg).toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right ${driftClass}`}>
                    {drift == null ? "—" : `${drift > 0 ? "+" : ""}${drift.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        <strong>Caveats:</strong> vendor_key is normalized by lowercasing and stripping store-number suffixes
        — &quot;Locke&quot; and &quot;Locke Supply&quot; still appear separately and need a manual alias map
        (TBD). Stock-on-hand inventory and item-level cost variance both deferred — see
        project memos.
      </p>
    </PageShell>
  );
}
