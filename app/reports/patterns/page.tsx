// Customers showing recurring themes — preventative-agreement candidates.
//
// Three signals in one surface, ordered by leading-indicator strength:
//   1. customer_repeat_jobs_v — JOB-COUNT recurrence (came back N times).
//      Strongest leading indicator: customer paid for a real problem 2+ times.
//   2. customer_recurring_jobs_v — JOB-CONTENT recurrence (same KIND of job
//      came back). Uses the richer 2026-04-30 job embeddings (notes + linked
//      comm summaries; customer/tech name omitted) — catches "same problem,
//      different visit" cases that simple count misses.
//   3. customer_recurring_patterns_v — COMMUNICATION-level recurrence
//      (similar topics in messages). Tightest content signal but smallest
//      sample — requires importance ≥5 comm events.

import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Table, fmtDateShort, fmtMoney, type Column } from "../../../components/Table";

export const metadata = { title: "Patterns · TPAR-DB" };

type RepeatJobRow = {
  hcp_customer_id: string;
  customer_name: string | null;
  job_count_12mo: number;
  earliest_job: string | null;
  latest_job: string | null;
  span_days: number | null;
  avg_days_between: number | null;
  total_revenue_12mo: number | null;
  techs_seen: string[] | null;
  preventative_candidate: boolean;
};

type RecurringJobRow = {
  hcp_customer_id: string;
  customer_name: string | null;
  recurring_job_pairs: number;
  max_similarity: number;
  earliest_job: string | null;
  most_recent_job: string | null;
  sample_job_a: string | null;
  sample_job_b: string | null;
};

type CommPatternRow = {
  hcp_customer_id: string;
  customer_name: string | null;
  recurring_pair_count: number;
  max_similarity: number;
  earliest_event_date: string | null;
  most_recent_event_date: string | null;
  sample_summary_a: string | null;
  sample_summary_b: string | null;
};

export default async function PatternsReport() {
  const supa = db();
  const [repeatRes, recurringJobsRes, commRes] = await Promise.all([
    supa
      .from("customer_repeat_jobs_v")
      .select("*")
      .eq("preventative_candidate", true)
      .order("job_count_12mo", { ascending: false })
      .limit(50),
    supa
      .from("customer_recurring_jobs_v")
      .select("*")
      .order("recurring_job_pairs", { ascending: false })
      .limit(50),
    supa
      .from("customer_recurring_patterns_v")
      .select("*")
      .order("recurring_pair_count", { ascending: false })
      .limit(50),
  ]);
  const repeatRows = (repeatRes.data ?? []) as RepeatJobRow[];
  const recurringJobsRows = (recurringJobsRes.data ?? []) as RecurringJobRow[];
  const commRows = (commRes.data ?? []) as CommPatternRow[];

  const repeatColumns: Column<RepeatJobRow>[] = [
    { header: "Customer", cell: (r) => r.customer_name ?? "—", className: "font-medium text-neutral-900" },
    { header: "Jobs (12mo)", cell: (r) => r.job_count_12mo, align: "right" },
    {
      header: "Span",
      cell: (r) => `${r.span_days ?? "?"}d`,
      align: "right",
      className: "text-neutral-600",
    },
    {
      header: "Avg gap",
      cell: (r) => (r.avg_days_between != null ? `${r.avg_days_between}d` : "—"),
      align: "right",
      className: "text-neutral-600",
    },
    {
      header: "Revenue",
      cell: (r) => <span className="font-medium">{fmtMoney(r.total_revenue_12mo)}</span>,
      align: "right",
    },
    { header: "First", cell: (r) => fmtDateShort(r.earliest_job), className: "text-neutral-600 text-xs" },
    { header: "Latest", cell: (r) => fmtDateShort(r.latest_job), className: "text-neutral-600 text-xs" },
    {
      header: "Techs",
      cell: (r) => (
        <span className="text-xs text-neutral-600">{(r.techs_seen ?? []).slice(0, 3).join(", ") || "—"}</span>
      ),
    },
  ];

  const recurringJobColumns: Column<RecurringJobRow>[] = [
    { header: "Customer", cell: (r) => r.customer_name ?? "—", className: "font-medium text-neutral-900" },
    { header: "Job pairs", cell: (r) => r.recurring_job_pairs, align: "right" },
    { header: "Max sim", cell: (r) => Number(r.max_similarity).toFixed(2), align: "right", className: "text-neutral-600" },
    { header: "First", cell: (r) => fmtDateShort(r.earliest_job), className: "text-neutral-600 text-xs" },
    { header: "Latest", cell: (r) => fmtDateShort(r.most_recent_job), className: "text-neutral-600 text-xs" },
    {
      header: "Sample job",
      cell: (r) => (
        <div className="max-w-xl whitespace-pre-line text-xs text-neutral-600">
          {r.sample_job_a ? r.sample_job_a.slice(0, 300) : "—"}
        </div>
      ),
    },
  ];

  const commColumns: Column<CommPatternRow>[] = [
    { header: "Customer", cell: (r) => r.customer_name ?? "—", className: "font-medium text-neutral-900" },
    { header: "Pairs", cell: (r) => r.recurring_pair_count, align: "right" },
    { header: "Max sim", cell: (r) => Number(r.max_similarity).toFixed(2), align: "right", className: "text-neutral-600" },
    { header: "First", cell: (r) => fmtDateShort(r.earliest_event_date), className: "text-neutral-600 text-xs" },
    { header: "Latest", cell: (r) => fmtDateShort(r.most_recent_event_date), className: "text-neutral-600 text-xs" },
    {
      header: "Sample theme",
      cell: (r) => (
        <div className="max-w-xl text-xs italic text-neutral-600">
          {r.sample_summary_a ? r.sample_summary_a.slice(0, 220) : "—"}
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title="Patterns"
      description="Customers showing recurring themes — preventative-agreement candidates. Two signals: repeat jobs (came back) and recurring comms (same topic)."
    >
      <section className="mb-8">
        <header className="mb-2">
          <h2 className="text-base font-semibold text-neutral-900">Repeat-job customers (last 12 months)</h2>
          <p className="text-xs text-neutral-500">
            {repeatRows.length} customer{repeatRows.length === 1 ? "" : "s"} flagged as preventative-agreement candidates (3+ visits in 12mo, or 2+ within 6mo).
          </p>
        </header>
        <Table
          columns={repeatColumns}
          rows={repeatRows}
          rowHref={(r) => (r.hcp_customer_id ? `/customer/${r.hcp_customer_id}` : null)}
          emptyText="No repeat-job customers in the last 12 months."
        />
      </section>

      <section className="mb-8">
        <header className="mb-2">
          <h2 className="text-base font-semibold text-neutral-900">Recurring same-kind jobs (content-similar across visits)</h2>
          <p className="text-xs text-neutral-500">
            Two jobs at the same customer, ≥14 days apart, cosine ≥0.70 on the richer 2026-04-30 job embeddings. Catches "same problem returned" patterns that pure visit count misses.
          </p>
        </header>
        <Table
          columns={recurringJobColumns}
          rows={recurringJobsRows}
          rowHref={(r) => (r.hcp_customer_id ? `/customer/${r.hcp_customer_id}` : null)}
          emptyText="No content-similar job recurrences detected."
        />
      </section>

      <section>
        <header className="mb-2">
          <h2 className="text-base font-semibold text-neutral-900">Recurring comm-event themes</h2>
          <p className="text-xs text-neutral-500">
            Filtered to importance ≥5, ≥7 days apart, cosine ≥0.75. Tightened 2026-04-30 to exclude attachment-link / incomplete-message noise.
          </p>
        </header>
        <Table
          columns={commColumns}
          rows={commRows}
          rowHref={(r) => (r.hcp_customer_id ? `/customer/${r.hcp_customer_id}` : null)}
          emptyText="No recurring comm patterns detected."
        />
      </section>
    </PageShell>
  );
}
