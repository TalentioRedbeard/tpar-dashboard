// Estimates pipeline. Sources from bid_estimates (Tool 3 table). Pipeline view
// grouped by status with counts, plus a detail table.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { Table, StatusPill, fmtMoney, fmtDateShort, type Column } from "../../components/Table";
import { StatCard } from "../../components/ui/StatCard";

export const metadata = { title: "Estimates · TPAR-DB" };

type EstRow = {
  id: string;
  project_name: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  hcp_job_id: string | null;
  hcp_estimate_id: string | null;
  hcp_estimate_number: string | null;
  status: string | null;
  source: string | null;
  created_at: string;
  hcp_pushed_at: string | null;
  customer_approved_at: string | null;
  tech_authorized_at: string | null;
  created_by: string | null;
};

const STATUSES = ["draft", "preview", "approved", "pushed", "archived"] as const;

export default async function EstimatesPage() {
  const supa = db();
  const { data } = await supa
    .from("bid_estimates")
    .select("id, project_name, customer_name, hcp_customer_id, hcp_job_id, hcp_estimate_id, hcp_estimate_number, status, source, created_at, hcp_pushed_at, customer_approved_at, tech_authorized_at, created_by")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as EstRow[];

  // Status rollup
  const byStatus = new Map<string, number>();
  for (const r of rows) {
    const s = (r.status ?? "draft").toLowerCase();
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }

  const columns: Column<EstRow>[] = [
    { header: "Created", cell: (r) => fmtDateShort(r.created_at), className: "text-neutral-600" },
    { header: "Status", cell: (r) => r.status ? <StatusPill status={r.status} tone={
      r.status === "approved" || r.status === "pushed" ? "green" :
      r.status === "draft" ? "neutral" :
      r.status === "preview" ? "brand" :
      r.status === "archived" ? "slate" :
      "neutral"
    } /> : <span className="text-neutral-400">—</span> },
    {
      header: "Customer",
      cell: (r) =>
        r.hcp_customer_id ? (
          <Link href={`/customer/${r.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
            {r.customer_name ?? "—"}
          </Link>
        ) : (
          <span className="font-medium text-neutral-900">{r.customer_name ?? "—"}</span>
        ),
    },
    { header: "Project", cell: (r) => r.project_name ?? "—", className: "max-w-md text-xs text-neutral-700" },
    {
      header: "HCP estimate",
      cell: (r) =>
        r.hcp_estimate_number ? (
          <span className="font-mono text-xs">#{r.hcp_estimate_number}</span>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
    },
    { header: "By", cell: (r) => r.created_by ?? "—", className: "text-neutral-600" },
    {
      header: "Approved",
      cell: (r) =>
        r.customer_approved_at ? (
          <span className="text-emerald-700">{fmtDateShort(r.customer_approved_at)}</span>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
    },
  ];

  return (
    <PageShell
      title="Estimates"
      description="Drafts, previewed, approved, pushed-to-HCP, and archived estimates from Tool 3."
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

      <Table
        columns={columns}
        rows={rows}
        rowHref={(r) => (r.hcp_job_id ? `/job/${r.hcp_job_id}` : null)}
        emptyText="No estimates found."
      />
    </PageShell>
  );
}
