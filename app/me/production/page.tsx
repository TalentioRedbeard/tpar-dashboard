// /me/production — a tech's own revenue picture ("what pertains to me"): what
// THEY have produced, never the company total. Reads the trusted per-tech rollup
// tech_kpi_current_v1 (keyed on hcp_full_name; its $ columns are DOLLARS, NOT
// cents — same view /me's snapshot uses) for the headline numbers, plus the
// tech's own recent completed appointments (appointments_master.total_amount is
// CENTS) for the jobs behind the revenue. Linked from /me's "My 30-day snapshot".

import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "../../../lib/supabase";
import { getCurrentTech } from "../../../lib/current-tech";
import { PageShell } from "../../../components/PageShell";
import { fmtMoney } from "../../../components/Table";

export const metadata = { title: "My production · TPAR-DB" };
export const dynamic = "force-dynamic";

const CHI = "America/Chicago";

type Kpi = Record<string, unknown>;
type CompletedAppt = {
  hcp_job_id: string | null;
  scheduled_start: string;
  customer_name: string | null;
  status: string | null;
  total_amount: number | null;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
};

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
}
function kpiDollars(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function kpiNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-emerald-200 bg-emerald-50" : "border-neutral-200 bg-white"}`}>
      <div className={`text-xs uppercase tracking-wide ${accent ? "text-emerald-700" : "text-neutral-500"}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? "text-emerald-900" : "text-neutral-900"}`}>{value}</div>
      {sub ? <div className={`text-xs ${accent ? "text-emerald-700/80" : "text-neutral-500"}`}>{sub}</div> : null}
    </div>
  );
}

export default async function MyProductionPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/me/production");
  if (!me.tech) redirect("/me"); // signed in but not a tech (office) → home

  const techShort = me.tech.tech_short_name;
  const fullName = me.tech.hcp_full_name;
  const supa = db();

  const since45 = new Date(Date.now() - 45 * 86_400_000).toISOString();

  let kpi: Kpi | null = null;
  let completedRaw: CompletedAppt[] = [];
  if (fullName) {
    const [kpiRes, apptRes] = await Promise.all([
      supa.from("tech_kpi_current_v1").select("*").eq("tech_name", fullName).limit(1).maybeSingle(),
      supa
        .from("appointments_master")
        .select("hcp_job_id, scheduled_start, customer_name, status, total_amount, tech_primary_name, tech_all_names")
        .is("deleted_at", null)
        .ilike("status", "complete%")
        .gte("scheduled_start", since45)
        .order("scheduled_start", { ascending: false }),
    ]);
    kpi = (kpiRes.data ?? null) as Kpi | null;
    completedRaw = (apptRes.data ?? []) as CompletedAppt[];
  }

  // Scope to THIS tech (primary or crew member) — JS filter avoids PostgREST
  // array-contains quoting on names with spaces — then only jobs with revenue.
  const completed = completedRaw
    .filter((a) => a.tech_primary_name === fullName || (a.tech_all_names ?? []).includes(fullName ?? ""))
    .filter((a) => (Number(a.total_amount) || 0) > 0)
    .slice(0, 30);

  const rev30 = kpiDollars(kpi?.revenue_30d);
  const rev7 = kpiDollars(kpi?.revenue_7d);
  const avgTicket = kpiDollars(kpi?.avg_invoice_value_30d);
  const outstanding = kpiDollars(kpi?.outstanding_amount_30d);
  const jobs30 = kpiNum(kpi?.jobs_completed_30d);
  const participated30 = kpiNum(kpi?.jobs_participated_30d);
  const collection = kpiNum(kpi?.collection_rate_pct_30d);
  const fieldHours = kpiNum(kpi?.total_field_hours_30d);

  return (
    <PageShell
      title="My production"
      description={`What you've produced — your own jobs only · ${techShort}`}
      backHref="/me"
      backLabel="My day"
      help={{
        intent: "Your own revenue picture — the jobs you've completed and what they brought in. Only your work; never the company total.",
        actions: [
          "Top numbers are your last 30 days (recomputed nightly).",
          "The list is your recent completed jobs — tap one to open it.",
          "Outstanding = invoices on your jobs not yet collected.",
        ],
      }}
    >
      {!fullName ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP name isn&apos;t linked yet, so we can&apos;t total your production. Ask Danny to set your HCP name in the tech directory.
        </div>
      ) : !kpi ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No production snapshot yet for {techShort} — it builds as you complete jobs (recomputed nightly).
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard accent label="Revenue · 30d" value={rev30 != null ? fmtMoney(rev30) : "—"} sub={`${jobs30 ?? 0} job${jobs30 === 1 ? "" : "s"} completed`} />
            <StatCard label="Avg ticket" value={avgTicket != null ? fmtMoney(avgTicket) : "—"} sub="per completed job" />
            <StatCard label="Revenue · 7d" value={rev7 != null ? fmtMoney(rev7) : "—"} sub="this week" />
            <StatCard label="Jobs worked · 30d" value={participated30 != null ? String(participated30) : "—"} sub="incl. assists" />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Collection rate" value={collection != null ? `${Math.round(collection)}%` : "—"} sub="of your invoiced $" />
            <StatCard label="Outstanding" value={outstanding != null ? fmtMoney(outstanding) : "—"} sub="not yet collected" />
            <StatCard label="Field hours · 30d" value={fieldHours != null ? `${Math.round(fieldHours)}h` : "—"} />
            <StatCard label="Updated" value={kpi.computed_at ? fmtDay(String(kpi.computed_at)) : "—"} sub="nightly" />
          </div>

          <h2 className="mb-2 text-base font-semibold text-neutral-800">Your recent completed jobs</h2>
          {completed.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500">
              No completed jobs with revenue in the last 45 days.
            </div>
          ) : (
            <ul className="space-y-2">
              {completed.map((a, i) => {
                const dollars = (Number(a.total_amount) || 0) / 100;
                const assisting = !!a.tech_primary_name && a.tech_primary_name !== fullName;
                const body = (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 hover:border-brand-300 hover:shadow-sm">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-neutral-900">{a.customer_name ?? "—"}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        {fmtDay(a.scheduled_start)}{assisting ? ` · assisting ${a.tech_primary_name}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-neutral-800">{fmtMoney(dollars)}</span>
                  </div>
                );
                return a.hcp_job_id ? (
                  <li key={`${a.hcp_job_id}-${i}`}><Link href={`/job/${a.hcp_job_id}`} className="block">{body}</Link></li>
                ) : (
                  <li key={i}>{body}</li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-xs text-neutral-500">
            Your own jobs only. The list shows recent completed appointments that carry an invoice amount — it may not exactly equal the 30-day total (different windows). Numbers refresh nightly.
          </p>
        </>
      )}
    </PageShell>
  );
}
