// Margin report. Sources from job_cost_v2 (Bouncie drive time + tech_burden_rates
// derived labor cost + revenue-weighted margin per tech).

import Link from "next/link";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Table, fmtMoney, fmtPct, fmtDateShort, type Column } from "../../../components/Table";

export const metadata = { title: "Margin · TPAR-DB" };

type V2Row = {
  hcp_job_id: string;
  hcp_customer_id: string | null;
  customer_name: string | null;
  job_date: string | null;
  tech_primary_name: string | null;
  revenue: number | null;
  derived_labor_cost: number | null;
  derived_total_cost: number | null;
  derived_gross_margin_pct: number | null;
  margin_data_quality: string | null;
};

export default async function MarginReport() {
  const supa = db();
  // Last 30 days of jobs with margin_data_quality != 'insufficient'
  const sinceDate = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const { data } = await supa
    .from("job_cost_v2")
    .select("hcp_job_id, hcp_customer_id, customer_name, job_date, tech_primary_name, revenue, derived_labor_cost, derived_total_cost, derived_gross_margin_pct, margin_data_quality")
    .gte("job_date", sinceDate)
    .neq("margin_data_quality", "insufficient")
    .order("job_date", { ascending: false, nullsFirst: false })
    .limit(500);
  const rows = (data ?? []) as V2Row[];

  // Per-tech rollup
  const byTech = new Map<string, { jobs: number; rev: number; derivedCost: number }>();
  for (const r of rows) {
    const t = r.tech_primary_name ?? "Unassigned";
    const cur = byTech.get(t) ?? { jobs: 0, rev: 0, derivedCost: 0 };
    cur.jobs += 1;
    cur.rev += Number(r.revenue) || 0;
    cur.derivedCost += Number(r.derived_total_cost) || 0;
    byTech.set(t, cur);
  }
  const techRollup = Array.from(byTech.entries())
    .map(([tech, v]) => ({
      tech,
      jobs: v.jobs,
      rev: v.rev,
      derivedCost: v.derivedCost,
      margin: v.rev > 0 ? ((v.rev - v.derivedCost) / v.rev) * 100 : null,
    }))
    .sort((a, b) => b.rev - a.rev);

  const totalRev = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const totalCost = rows.reduce((s, r) => s + (Number(r.derived_total_cost) || 0), 0);
  const overallMargin = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : null;

  const columns: Column<V2Row>[] = [
    { header: "Date", cell: (r) => fmtDateShort(r.job_date), className: "text-neutral-600" },
    {
      header: "Customer",
      cell: (r) =>
        r.hcp_customer_id ? (
          <Link href={`/customer/${r.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
            {r.customer_name ?? "—"}
          </Link>
        ) : (
          <span className="font-medium text-neutral-900">{r.customer_name ?? "—"}</span>
        ),
    },
    { header: "Tech", cell: (r) => r.tech_primary_name ?? "—" },
    { header: "Revenue", cell: (r) => fmtMoney(r.revenue), align: "right" },
    { header: "Derived cost", cell: (r) => fmtMoney(r.derived_total_cost), align: "right", className: "text-neutral-600" },
    { header: "Margin", cell: (r) => fmtPct(r.derived_gross_margin_pct), align: "right" },
    { header: "Quality", cell: (r) => r.margin_data_quality, className: "text-xs text-neutral-500" },
  ];

  return (
    <PageShell
      title="Margin"
      description={`Last 30 days, cost-validated jobs only. ${rows.length} jobs · ${fmtMoney(totalRev)} revenue · ${fmtMoney(totalRev - totalCost)} margin · ${fmtPct(overallMargin)} avg.`}
    >
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">By tech (last 30 days)</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {techRollup.map((t) => (
            <div key={t.tech} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="text-base font-medium text-neutral-900">{t.tech}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-neutral-500">Jobs</div>
                <div className="text-right text-neutral-900">{t.jobs}</div>
                <div className="text-neutral-500">Revenue</div>
                <div className="text-right text-neutral-900">{fmtMoney(t.rev)}</div>
                <div className="text-neutral-500">Margin</div>
                <div className="text-right font-medium text-neutral-900">{fmtPct(t.margin)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Job detail</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Uses placeholder $35/tech-hr (= $70/hr per 2-person truck — Kelsey-supplied 2026-05-06) until per-tech actuals are entered.
        Same numbers the morning broadcast uses. Quality flag: <code>derived</code> = GPS hours × burden;{" "}
        <code>hcp</code> = HCP-native (only when burden is configured). Internal jobs excluded.
      </p>
      <Table
        columns={columns}
        rows={rows}
        rowHref={(r) => (r.hcp_job_id ? `/job/${r.hcp_job_id}` : null)}
        emptyText="No cost-validated jobs in the last 30 days."
      />
    </PageShell>
  );
}
