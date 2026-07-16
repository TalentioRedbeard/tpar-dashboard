// /estimates tech-scoped view — sent HCP estimates on the customers this tech is
// scheduled with ("what pertains to me"). The leadership pipeline shows the whole
// company; this scopes to the tech's scheduled customers (same mechanism as before).
//
// Re-sourced 2026-06-19 from bid_estimates (the 47-row internal builder) to
// estimate_pipeline_v (the 3,040 real sent HCP estimates). Stage = HCP-derived
// (won/declined/expired/awaiting). Rows link to HCP, AI-built ones to /estimate/[id].

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { techScopedCustomerIds } from "@/lib/tech-scope";
import { TechEstimatesList, type EstRow } from "./TechEstimatesList";

type Est = {
  hcp_estimate_id: string;
  hcp_customer_id: string | null;
  customer_name: string | null;
  estimate_number: string | null;
  stage: string | null;
  total_dollars: number | string | null;
  min_dollars: number | string | null;
  option_count: number | null;
  last_activity: string | null;
  is_ai_built: boolean | null;
  bid_estimate_id: string | null;
};

function fmtAmount(e: Est): string {
  const max = e.total_dollars == null ? null : Number(e.total_dollars);
  const min = e.min_dollars == null ? null : Number(e.min_dollars);
  if (max == null || !Number.isFinite(max)) return "—";
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if ((e.option_count ?? 0) > 1 && min != null && Number.isFinite(min) && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt(max);
}

export async function TechEstimatesView({ hcpEmployeeId, shortName }: { hcpEmployeeId: string | null; shortName: string }) {
  const supa = db();

  // Canonical scope rule (Danny 2026-07-16): full work history, crew counts,
  // matched by hcp_employee_id — appointments ∪ job records (the old view was
  // name-matched and 90-day-windowed, so techs lost older customers' estimates).
  const ids = [...(await techScopedCustomerIds(hcpEmployeeId))];

  let estimates: Est[] = [];
  // Chunked .in() — full-history customer sets run 250+ ids. Caps raised for
  // A6 search: a 60-row window would make the search box lie about history
  // (same truncation class as the admin 500-cap click-bug).
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supa
      .from("estimate_pipeline_v")
      .select("hcp_estimate_id, hcp_customer_id, customer_name, estimate_number, stage, total_dollars, min_dollars, option_count, last_activity, is_ai_built, bid_estimate_id")
      .in("hcp_customer_id", ids.slice(i, i + 100))
      .order("last_activity", { ascending: false, nullsFirst: false })
      .limit(1000);
    estimates.push(...((data ?? []) as Est[]));
  }
  estimates = estimates
    .sort((a, b) => String(b.last_activity ?? "").localeCompare(String(a.last_activity ?? "")))
    .slice(0, 500);

  // Serializable rows for the client list; href logic lives here (server).
  const listRows: EstRow[] = estimates.map((e) => ({
    id: e.hcp_estimate_id,
    href: e.is_ai_built && e.bid_estimate_id ? `/estimate/${e.bid_estimate_id}` : `/estimate/${e.hcp_estimate_id}`,
    customerName: e.customer_name ?? "—",
    estimateNumber: e.estimate_number ?? "",
    stage: (e.stage ?? "awaiting").toLowerCase(),
    amountLabel: fmtAmount(e),
    lastActivity: e.last_activity,
  }));

  return (
    <PageShell
      title="My estimates"
      description={`Estimates on your customers — full work history · ${shortName}`}
      help={{
        intent: "Every estimate on your customers — full work history — with where each one stands (awaiting / won / declined / expired).",
        actions: [
          "Search by customer name or estimate # — it covers your whole history, not just recent.",
          "Chips: Awaiting = still with the customer · Last 90 days · A–Z.",
          "Tap one to open it right here in the app.",
          "New estimate: open the job → Estimate, or My day → Estimate.",
        ],
        stuck: <>Missing one you swear you wrote? If you weren&apos;t on that customer&apos;s work it&apos;s outside your view — ask Danny.</>,
      }}
    >
      {!hcpEmployeeId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP profile isn&apos;t linked yet, so we can&apos;t match your customers. Ask Danny to link your HCP employee id in the tech directory.
        </div>
      ) : estimates.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          No estimates yet on your scheduled customers. Start one from a job: <Link href="/find" className="underline">find a job →</Link>, then tap Estimate.
        </div>
      ) : (
        <TechEstimatesList rows={listRows} />
      )}
    </PageShell>
  );
}
