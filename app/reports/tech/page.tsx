// Per-tech KPI report. Sources from tech_kpi_current_v1 — one row per active
// tech, snapshot recomputed nightly. Sorted by 30d revenue desc.

import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Table, fmtMoney, fmtPct, type Column } from "../../../components/Table";

export const metadata = { title: "Tech KPIs · TPAR-DB" };

type TechRow = {
  tech_name: string;
  is_van_lead: boolean | null;
  jobs_completed_7d: number | null;
  revenue_7d: number | null;
  appts_7d: number | null;
  jobs_completed_30d: number | null;
  revenue_30d: number | null;
  avg_invoice_value_30d: number | null;
  appts_30d: number | null;
  gps_match_pct_30d: number | null;
  on_time_pct_30d: number | null;
  late_arrivals_30d: number | null;
  avg_time_on_site_min: number | null;
  collection_rate_pct_30d: number | null;
  outstanding_amount_30d: number | null;
  open_invoices_30d: number | null;
  days_in_field: number | null;
  avg_field_hours_per_day: number | null;
  computed_at: string | null;
};

function fmtNum(n: unknown, suffix = ""): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `${Math.round(v)}${suffix}` : "—";
}

function fmtNum1(n: unknown, suffix = ""): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(1)}${suffix}` : "—";
}

function tone(pct: number | null, goodAt = 90, warnAt = 75): string {
  if (pct == null) return "text-neutral-500";
  if (pct >= goodAt) return "text-emerald-700";
  if (pct >= warnAt) return "text-amber-700";
  return "text-red-700";
}

export default async function TechReport() {
  const supa = db();
  const { data } = await supa
    .from("tech_kpi_current_v1")
    .select("*")
    .order("revenue_30d", { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as TechRow[];

  const totalRevenue30d = rows.reduce((s, r) => s + (Number(r.revenue_30d) || 0), 0);
  const totalAppts30d   = rows.reduce((s, r) => s + (Number(r.appts_30d)   || 0), 0);
  const totalAR         = rows.reduce((s, r) => s + (Number(r.outstanding_amount_30d) || 0), 0);

  const columns: Column<TechRow>[] = [
    {
      header: "Tech",
      cell: (r) => (
        <div>
          <div className="font-medium text-neutral-900">{r.tech_name}</div>
          {r.is_van_lead ? <div className="text-xs text-neutral-500">van lead</div> : null}
        </div>
      ),
    },
    {
      header: "30d revenue",
      cell: (r) => <span className="font-medium">{fmtMoney(r.revenue_30d)}</span>,
      align: "right",
    },
    {
      header: "Avg ticket",
      cell: (r) => fmtMoney(r.avg_invoice_value_30d),
      align: "right",
    },
    {
      header: "Jobs 30d",
      cell: (r) => fmtNum(r.jobs_completed_30d),
      align: "right",
    },
    {
      header: "On-time",
      cell: (r) => <span className={tone(Number(r.on_time_pct_30d))}>{fmtPct(r.on_time_pct_30d)}</span>,
      align: "right",
    },
    {
      header: "GPS match",
      cell: (r) => <span className={tone(Number(r.gps_match_pct_30d))}>{fmtPct(r.gps_match_pct_30d)}</span>,
      align: "right",
    },
    {
      header: "Late",
      cell: (r) => fmtNum(r.late_arrivals_30d),
      align: "right",
    },
    {
      header: "Time on-site",
      cell: (r) => fmtNum(r.avg_time_on_site_min, "m"),
      align: "right",
      className: "text-neutral-600",
    },
    {
      header: "Field hrs/day",
      cell: (r) => fmtNum1(r.avg_field_hours_per_day, "h"),
      align: "right",
      className: "text-neutral-600",
    },
    {
      header: "Collection",
      cell: (r) => <span className={tone(Number(r.collection_rate_pct_30d), 95, 85)}>{fmtPct(r.collection_rate_pct_30d)}</span>,
      align: "right",
    },
    {
      header: "AR open",
      cell: (r) => (
        <span className={(Number(r.outstanding_amount_30d) || 0) > 5000 ? "font-medium text-red-700" : "text-neutral-700"}>
          {fmtMoney(r.outstanding_amount_30d)}
        </span>
      ),
      align: "right",
    },
  ];

  const computedAt = rows[0]?.computed_at;

  return (
    <PageShell
      title="Tech KPIs"
      description={`${rows.length} tech${rows.length === 1 ? "" : "s"} · 30d totals: ${fmtMoney(totalRevenue30d)} revenue across ${totalAppts30d} appts · ${fmtMoney(totalAR)} AR open`}
    >
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs font-medium text-neutral-500">Active techs</div>
          <div className="mt-1 text-xl font-semibold text-neutral-900">{rows.length}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs font-medium text-neutral-500">30d revenue</div>
          <div className="mt-1 text-xl font-semibold text-neutral-900">{fmtMoney(totalRevenue30d)}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs font-medium text-neutral-500">30d appts</div>
          <div className="mt-1 text-xl font-semibold text-neutral-900">{totalAppts30d}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs font-medium text-neutral-500">AR open</div>
          <div className="mt-1 text-xl font-semibold text-red-700">{fmtMoney(totalAR)}</div>
        </div>
      </section>

      <Table columns={columns} rows={rows} emptyText="No active techs found." />

      {computedAt ? (
        <div className="mt-3 text-xs text-neutral-500">
          Snapshot computed {new Date(computedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}.
        </div>
      ) : null}
    </PageShell>
  );
}
