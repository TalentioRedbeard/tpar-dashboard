// Live cost-to-date vs estimate panel (#3, 2026-06-18). Self-contained server component:
// reads job_cost_to_date_v (folds HCP+receipts materials, GPS-derived labor, AND on-site
// job_materials_used into a running cost-to-date) and shows it against the job's estimate
// (latest non-archived bid_estimate) + revenue (live margin). Leadership-only (admin +
// manager) — renders nothing otherwise. Drop into the job page with:
//   {canEdit ? <CostToDatePanel hcpJobId={id} /> : null}

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

const money = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
};

type Row = {
  materials_cost: number | null;
  receipts_cost: number | null;
  derived_labor_cost: number | null;
  materials_used_cost: number | null;
  cost_to_date: number | null;
  estimate_total: number | null;
  pct_of_estimate: number | null;
  revenue: number | null;
  margin_to_date_pct: number | null;
};

export async function CostToDatePanel({ hcpJobId }: { hcpJobId: string }) {
  const me = await getCurrentTech().catch(() => null);
  if (!me || (!me.isAdmin && !me.isManager)) return null;
  const { data } = await db().from("job_cost_to_date_v").select("*").eq("hcp_job_id", hcpJobId).maybeSingle();
  if (!data) return null;
  const d = data as Row;

  const cost = Number(d.cost_to_date) || 0;
  const hasEstimate = d.estimate_total != null && Number(d.estimate_total) > 0;
  const denom = hasEstimate ? Number(d.estimate_total) : (Number(d.revenue) || 0);
  const pct = denom > 0 ? Math.min(100, Math.round((cost / denom) * 100)) : null;
  const over = denom > 0 && cost > denom;
  const margin = d.margin_to_date_pct != null ? Number(d.margin_to_date_pct) : null;
  const marginTone = margin == null ? "text-neutral-400" : margin >= 30 ? "text-emerald-700" : margin >= 10 ? "text-amber-700" : "text-red-700";

  return (
    <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-neutral-800">Cost to date</h4>
        <span className="text-sm">
          <span className="font-mono font-semibold text-neutral-900">{money(cost)}</span>
          {hasEstimate ? <span className="text-neutral-500"> of {money(d.estimate_total)} est.</span> : <span className="text-neutral-500"> · {money(d.revenue)} billed</span>}
          {margin != null ? <span className={`ml-2 font-medium ${marginTone}`}>{margin}% margin</span> : null}
        </span>
      </div>

      {pct != null ? (
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div className={`h-full rounded-full ${over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-600 md:grid-cols-4">
        <div>Materials (HCP+receipts)<div className="font-mono text-neutral-900">{money(d.materials_cost)}</div></div>
        <div>Labor (GPS-derived)<div className="font-mono text-neutral-900">{money(d.derived_labor_cost)}</div></div>
        <div>Logged on-site<div className="font-mono text-neutral-900">{money(d.materials_used_cost)}</div></div>
        <div>{hasEstimate ? "% of estimate" : "Billed revenue"}<div className="font-mono text-neutral-900">{hasEstimate ? `${d.pct_of_estimate ?? "—"}%` : money(d.revenue)}</div></div>
      </div>

      {over ? (
        <p className="mt-2 text-xs font-medium text-red-700">⚠ Cost has exceeded the {hasEstimate ? "estimate" : "billed revenue"} — review pricing / scope.</p>
      ) : null}
      <p className="mt-2 text-[11px] leading-snug text-neutral-400">
        Running total as costs land (HCP line items refresh on “Refresh from HCP”; receipts as reconciled; on-site materials as logged). Labor is GPS-derived (burden rate), not actual.
      </p>
    </div>
  );
}
