// /estimates tech-scoped view — estimates on the jobs/customers this tech is
// scheduled with ("what pertains to me"). The leadership pipeline shows pricing
// across ALL customers; this scopes to the tech's scheduled customers.
//
// NOTE: bid_estimates.created_by is currently all "Danny" (no tech-created rows
// yet, tech_authorized_at all null), so scoping by creator would be empty for
// every tech. We scope by the tech's scheduled customers instead — it shows
// estimate drafts on their jobs and fills in as techs start building estimates
// (the multi-option builder is reachable from any job). Rendered from /estimates
// when the viewer is a tech.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";

const CHI = "America/Chicago";

type ApptLite = {
  hcp_customer_id: string | null;
  scheduled_start: string;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
};
type Est = {
  id: string;
  project_name: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  hcp_job_id: string | null;
  status: string | null;
  created_at: string | null;
};

function fmtDay(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
}
function statusPill(st: string | null): { cls: string; label: string } {
  const s = (st ?? "draft").toLowerCase();
  if (s === "approved" || s === "pushed") return { cls: "bg-emerald-100 text-emerald-800", label: s };
  if (s === "preview") return { cls: "bg-brand-100 text-brand-800", label: s };
  if (s === "archived") return { cls: "bg-neutral-100 text-neutral-500", label: s };
  return { cls: "bg-amber-100 text-amber-800", label: s };
}

export async function TechEstimatesView({ fullName, shortName }: { fullName: string | null; shortName: string }) {
  const supa = db();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString();

  const custIds = new Set<string>();
  if (fullName) {
    const { data: appts } = await supa
      .from("appointments_master")
      .select("hcp_customer_id, scheduled_start, tech_primary_name, tech_all_names")
      .is("deleted_at", null)
      .gte("scheduled_start", since)
      .lt("scheduled_start", until);
    for (const a of (appts ?? []) as ApptLite[]) {
      const mine = a.tech_primary_name === fullName || (a.tech_all_names ?? []).includes(fullName);
      if (mine && a.hcp_customer_id) custIds.add(a.hcp_customer_id);
    }
  }
  const ids = [...custIds];

  let estimates: Est[] = [];
  if (ids.length) {
    const { data } = await supa
      .from("bid_estimates")
      .select("id, project_name, customer_name, hcp_customer_id, hcp_job_id, status, created_at")
      .in("hcp_customer_id", ids)
      .order("created_at", { ascending: false })
      .limit(60);
    estimates = (data ?? []) as Est[];
  }

  return (
    <PageShell
      title="My estimates"
      description={`Estimates on your scheduled customers · ${shortName}`}
      help={{
        intent: "Estimate drafts on the customers you're scheduled with. Tap one to view or keep building it. To start a new one, open the job and tap Estimate.",
        actions: [
          "Scoped to your scheduled customers (last 3 months + upcoming).",
          "Tap an estimate to open it (good/better/best options).",
          "New estimate: open the job → Estimate, or My day → Estimate.",
        ],
      }}
    >
      {!fullName ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP name isn&apos;t linked yet, so we can&apos;t match your customers. Ask Danny to set your HCP name in the tech directory.
        </div>
      ) : estimates.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          No estimates yet on your scheduled customers. Start one from a job: <Link href="/find" className="underline">find a job →</Link>, then tap Estimate.
        </div>
      ) : (
        <ul className="space-y-2">
          {estimates.map((e) => {
            const pill = statusPill(e.status);
            return (
              <li key={e.id}>
                <Link href={`/estimate/${e.id}`} className="block">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 hover:border-brand-300 hover:shadow-sm">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-neutral-900">{e.project_name || e.customer_name || "Estimate"}</div>
                      <div className="mt-0.5 truncate text-xs text-neutral-500">{e.customer_name ?? "—"} · {fmtDay(e.created_at)}</div>
                    </div>
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
