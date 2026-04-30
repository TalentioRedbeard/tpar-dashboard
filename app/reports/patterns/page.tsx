// Customers showing recurring themes — preventative-agreement candidates.
// Sources from customer_recurring_patterns_v.

import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Table, fmtDateShort, type Column } from "../../../components/Table";

export const metadata = { title: "Patterns · TPAR-DB" };

type PatternRow = {
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
  const { data } = await supa
    .from("customer_recurring_patterns_v")
    .select("*")
    .order("recurring_pair_count", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as PatternRow[];

  const columns: Column<PatternRow>[] = [
    { header: "Customer", cell: (r) => r.customer_name ?? "—", className: "font-medium text-neutral-900" },
    { header: "Recurring pairs", cell: (r) => r.recurring_pair_count, align: "right" },
    { header: "Max sim", cell: (r) => Number(r.max_similarity).toFixed(2), align: "right", className: "text-neutral-600" },
    { header: "First seen", cell: (r) => fmtDateShort(r.earliest_event_date), className: "text-neutral-600" },
    { header: "Most recent", cell: (r) => fmtDateShort(r.most_recent_event_date), className: "text-neutral-600" },
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
      description="Customers showing recurring themes — strong preventative-agreement candidates. Filtered to importance ≥5, ≥7 days apart, cosine ≥0.75."
    >
      <Table
        columns={columns}
        rows={rows}
        rowHref={(r) => (r.hcp_customer_id ? `/customer/${r.hcp_customer_id}` : null)}
        emptyText="No recurring patterns detected."
      />
    </PageShell>
  );
}
