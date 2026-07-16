// Sent-estimate pipeline. Reads estimate_pipeline_v (the 3,040 REAL HCP estimates
// over hcp_estimates_raw), NOT bid_estimates (the 47-row internal builder, only 13
// HCP-linked). Pipeline stages = awaiting / won / declined / expired, derived from
// HCP work_status + per-option approval_status (see the view's migration). Rows link
// to HCP, except AI-built ones (also in bid_estimates) which link to /estimate/[id].

import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { StatCard } from "../../components/ui/StatCard";
import { EstimatePipelineTable, type PipelineRow } from "../../components/EstimatePipelineTable";
import { getCurrentTech } from "../../lib/current-tech";
import { TechEstimatesView } from "./TechEstimatesView";

export const metadata = { title: "Estimates · TPAR-DB" };

// Pipeline stages, in the order they're surfaced. Counts shown as StatCards.
const STAGES = ["awaiting", "won", "declined", "expired"] as const;
const STAGE_LABEL: Record<string, string> = {
  awaiting: "Awaiting",
  won: "Won",
  declined: "Declined",
  expired: "Expired",
};

export default async function EstimatesPage() {
  // Pipeline shows pricing + win/loss across all customers. Gate to admin/manager.
  const me = await getCurrentTech().catch(() => null);
  // Techs get estimates on their own scheduled customers instead of the company
  // pipeline; office users (no tech row) still go to /me.
  if (!me?.isAdmin && !me?.isManager) {
    if (me?.tech) {
      return <TechEstimatesView hcpEmployeeId={me.tech.hcp_employee_id} shortName={me.tech.tech_short_name} />;
    }
    redirect("/me");
  }
  const supa = db();
  // Newest activity first. 1,000 = the PostgREST per-request ceiling; the old
  // 500 cap silently hid reachable estimates (the subtler half of the
  // click-bug, plan §3.1). Full pagination rides with the EntityPageShell work.
  const { data } = await supa
    .from("estimate_pipeline_v")
    .select("hcp_estimate_id, hcp_customer_id, customer_name, estimate_number, stage, total_dollars, min_dollars, option_count, created_at, last_activity, age_days, is_ai_built, bid_estimate_id, hcp_url")
    .order("last_activity", { ascending: false, nullsFirst: false })
    .limit(1000);
  const rows = (data ?? []) as PipelineRow[];
  const atCap = rows.length >= 1000;

  const byStage = new Map<string, number>();
  for (const r of rows) {
    const s = (r.stage ?? "awaiting").toLowerCase();
    byStage.set(s, (byStage.get(s) ?? 0) + 1);
  }

  return (
    <PageShell
      icon="📄"
      title="Estimates"
      description="Sent HCP estimates by pipeline stage — awaiting a decision, won, declined, or expired. Click a row to open it in HCP (AI-built estimates open in the builder)."
    >
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {STAGES.map((s) => {
          const count = byStage.get(s) ?? 0;
          const tone =
            s === "won" ? "green" :
            s === "awaiting" ? "brand" :
            s === "declined" ? "amber" :
            "neutral";
          return <StatCard key={s} label={STAGE_LABEL[s]} value={count} tone={tone as "green" | "brand" | "amber" | "neutral"} />;
        })}
      </section>

      {atCap ? (
        <p className="mb-2 text-xs text-neutral-500">
          Showing the 1,000 most recently active estimates — use search to reach older history.
        </p>
      ) : null}
      {/* This page is already admin/manager-gated, so batch send is available
          to everyone who can see it; the send fn re-guards every item. */}
      <EstimatePipelineTable rows={rows} canBatchSend meEmail={me.email} />
    </PageShell>
  );
}
