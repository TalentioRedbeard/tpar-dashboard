// Estimates pipeline. Sources from bid_estimates (Tool 3 table). Pipeline
// view grouped by status with counts, plus a searchable / sortable detail
// table where every row links to /estimate/[id] for inline edit.

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { StatCard } from "../../components/ui/StatCard";
import { EstimatesTable, type EstimateRow } from "../../components/EstimatesTable";
import { getCurrentTech } from "../../lib/current-tech";
import { TechEstimatesView } from "./TechEstimatesView";

export const metadata = { title: "Estimates · TPAR-DB" };

const STATUSES = ["draft", "preview", "approved", "pushed", "archived"] as const;

export default async function EstimatesPage() {
  // Pipeline shows pricing + margins across all customers. Gate to admin/manager.
  const me = await getCurrentTech().catch(() => null);
  // Techs get estimates on their own scheduled customers instead of the company
  // pipeline; office users (no tech row) still go to /me.
  if (!me?.isAdmin && !me?.isManager) {
    if (me?.tech) {
      return <TechEstimatesView fullName={me.tech.hcp_full_name} shortName={me.tech.tech_short_name} />;
    }
    redirect("/me");
  }
  const supa = db();
  const { data } = await supa
    .from("bid_estimates")
    .select("id, project_name, customer_name, hcp_customer_id, hcp_job_id, hcp_estimate_id, hcp_estimate_number, status, source, created_at, hcp_pushed_at, customer_approved_at, tech_authorized_at, created_by")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as EstimateRow[];

  const canCreate = !!(me?.isAdmin || me?.isManager);

  const byStatus = new Map<string, number>();
  for (const r of rows) {
    const s = (r.status ?? "draft").toLowerCase();
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }

  return (
    <PageShell
      title="Estimates"
      description="Drafts, previewed, approved, pushed-to-HCP, and archived estimates. Click any row to view + edit."
      actions={canCreate ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/estimate/new"
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            + Build multi-option estimate
          </Link>
          <Link
            href="/dispatch/new-estimate"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Schedule estimate visit
          </Link>
        </div>
      ) : undefined}
    >
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUSES.map((s) => {
          const count = byStatus.get(s) ?? 0;
          const tone =
            s === "approved" || s === "pushed" ? "green" :
            s === "preview" ? "brand" :
            s === "archived" ? "neutral" :
            "neutral";
          return <StatCard key={s} label={s} value={count} tone={tone as "green" | "brand" | "neutral"} />;
        })}
      </section>

      <EstimatesTable rows={rows} />
    </PageShell>
  );
}
