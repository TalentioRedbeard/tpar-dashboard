// /jobs tech-scoped view — a tech's OWN jobs ("what pertains to me"). The
// leadership /jobs list exposes company-wide revenue + gross margin; this shows
// only the tech's assigned jobs and REDACTS margin/AR (revenue stays — that's
// "what you produced"). Source job_360 (revenue is DOLLARS), scoped on
// hcp_full_name (tech_primary_name / tech_all_names) — same match the leadership
// page's ?mine=1 uses. Rendered from /jobs when the viewer is a tech.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { fmtMoney } from "../../components/Table";

const CHI = "America/Chicago";

type Job = {
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  customer_name: string | null;
  job_date: string | null;
  appointment_status: string | null;
  revenue: number | null;
};

function fmtDay(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
}
function statusPill(st: string | null): { cls: string; label: string } {
  const s = (st ?? "").toLowerCase();
  if (s.includes("complete")) return { cls: "bg-emerald-100 text-emerald-800", label: "Complete" };
  if (s === "in progress" || s === "en route") return { cls: "bg-blue-100 text-blue-800", label: st ?? "In progress" };
  if (s.includes("cancel")) return { cls: "bg-red-50 text-red-700", label: st ?? "Canceled" };
  if (s === "scheduled" || s === "created job from estimate") return { cls: "bg-neutral-100 text-neutral-700", label: "Scheduled" };
  return { cls: "bg-neutral-100 text-neutral-700", label: st ?? "—" };
}

export async function TechJobsView({ fullName, shortName }: { fullName: string | null; shortName: string }) {
  let jobs: Job[] = [];
  if (fullName) {
    const supa = db();
    const { data } = await supa
      .from("job_360")
      .select("hcp_job_id, hcp_customer_id, customer_name, job_date, appointment_status, revenue")
      // Same scope the leadership list's ?mine=1 uses: primary OR on the crew.
      .or(`tech_primary_name.eq."${fullName}",tech_all_names.cs.{"${fullName}"}`)
      .not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")')
      .order("job_date", { ascending: false })
      .limit(60);
    jobs = (data ?? []) as Job[];
  }

  return (
    <PageShell
      title="My jobs"
      description={`Jobs you're assigned to · ${shortName}`}
      help={{
        intent: "Your own jobs — what you've worked and what's coming. Tap one to open it (history, notes, status, estimate). Only your work.",
        actions: [
          "Only jobs where you're the assigned tech or on the crew.",
          "$ is the job's revenue (your production); margins/AR aren't shown.",
          "For the calendar layout, use Schedule.",
        ],
      }}
    >
      {!fullName ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP name isn&apos;t linked yet, so we can&apos;t match your jobs. Ask Danny to set your HCP name in the tech directory.
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          No jobs assigned to you in the recent window. Check <Link href="/schedule" className="underline">My schedule →</Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j, i) => {
            const pill = statusPill(j.appointment_status);
            const dollars = Number(j.revenue) || 0;
            const body = (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 hover:border-brand-300 hover:shadow-sm">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-900">{j.customer_name ?? "—"}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-neutral-500">{fmtDay(j.job_date)}</span>
                    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
                  </div>
                </div>
                {dollars > 0 ? <span className="shrink-0 text-sm font-semibold text-neutral-700">{fmtMoney(dollars)}</span> : null}
              </div>
            );
            return j.hcp_job_id ? (
              <li key={`${j.hcp_job_id}-${i}`}><Link href={`/job/${j.hcp_job_id}`} className="block">{body}</Link></li>
            ) : (
              <li key={i}>{body}</li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
