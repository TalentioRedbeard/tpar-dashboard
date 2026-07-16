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
import { assignedHasEmployee } from "@/lib/assigned-employees";

const CHI = "America/Chicago";

type ApptLite = {
  hcp_customer_id: string | null;
  scheduled_start: string;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
};
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
  hcp_url: string | null;
};

function fmtDay(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
}
function stagePill(st: string | null): { cls: string; label: string } {
  const s = (st ?? "awaiting").toLowerCase();
  if (s === "won") return { cls: "bg-emerald-100 text-emerald-800", label: s };
  if (s === "awaiting") return { cls: "bg-brand-100 text-brand-800", label: s };
  if (s === "declined") return { cls: "bg-amber-100 text-amber-800", label: s };
  return { cls: "bg-neutral-100 text-neutral-500", label: s };
}
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
  const custIds = new Set<string>();
  if (hcpEmployeeId) {
    const { data: appts } = await supa
      .from("appointments_master")
      .select("hcp_customer_id")
      .is("deleted_at", null)
      .contains("tech_all_ids", [hcpEmployeeId])
      .limit(2000);
    for (const a of (appts ?? []) as Array<{ hcp_customer_id: string | null }>) {
      if (a.hcp_customer_id) custIds.add(a.hcp_customer_id);
    }
    const { data: jmRows } = await supa
      .from("jobs_master")
      .select("hcp_customer_id, assigned_employees")
      .like("assigned_employees", `%${hcpEmployeeId}%`)
      .not("hcp_customer_id", "is", null)
      .limit(2000);
    for (const j of (jmRows ?? []) as Array<{ hcp_customer_id: string | null; assigned_employees: string | null }>) {
      if (j.hcp_customer_id && assignedHasEmployee(j.assigned_employees, hcpEmployeeId)) custIds.add(j.hcp_customer_id);
    }
  }
  const ids = [...custIds];

  let estimates: Est[] = [];
  // Chunked .in() — full-history customer sets run 250+ ids.
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supa
      .from("estimate_pipeline_v")
      .select("hcp_estimate_id, hcp_customer_id, customer_name, estimate_number, stage, total_dollars, min_dollars, option_count, last_activity, is_ai_built, bid_estimate_id, hcp_url")
      .in("hcp_customer_id", ids.slice(i, i + 100))
      .order("last_activity", { ascending: false, nullsFirst: false })
      .limit(60);
    estimates.push(...((data ?? []) as Est[]));
  }
  estimates = estimates
    .sort((a, b) => String(b.last_activity ?? "").localeCompare(String(a.last_activity ?? "")))
    .slice(0, 60);

  return (
    <PageShell
      title="My estimates"
      description={`Estimates on your customers — full work history · ${shortName}`}
      help={{
        intent: "Sent HCP estimates on the customers you've worked for, with their pipeline stage (awaiting / won / declined / expired). Tap one to open it.",
        actions: [
          "Scoped to work you were on (lead or crew), all-time.",
          "Tap an estimate to open it in HCP (AI-built ones open in the builder).",
          "New estimate: open the job → Estimate, or My day → Estimate.",
        ],
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
        <ul className="space-y-2">
          {estimates.map((e) => {
            const pill = stagePill(e.stage);
            const href = e.is_ai_built && e.bid_estimate_id ? `/estimate/${e.bid_estimate_id}` : (e.hcp_url ?? "#");
            const external = !(e.is_ai_built && e.bid_estimate_id);
            const inner = (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 hover:border-brand-300 hover:shadow-sm">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-900">
                    {e.estimate_number ? `#${e.estimate_number}` : "Estimate"} · {e.customer_name ?? "—"}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500">{fmtAmount(e)} · {fmtDay(e.last_activity)}</div>
                </div>
                <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
              </div>
            );
            return (
              <li key={e.hcp_estimate_id}>
                {external ? (
                  <a href={href} target="_blank" rel="noreferrer" className="block">{inner}</a>
                ) : (
                  <Link href={href} className="block">{inner}</Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
