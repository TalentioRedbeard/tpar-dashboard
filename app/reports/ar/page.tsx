// Receivables / AR report. Sources from job_360 — every job with due_amount > 0,
// grouped into aging buckets.

import Link from "next/link";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Table, fmtMoney, fmtDateShort, type Column } from "../../../components/Table";

export const metadata = { title: "Receivables · TPAR-DB" };

type ARRow = {
  hcp_job_id: string;
  hcp_customer_id: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  job_date: string | null;
  tech_primary_name: string | null;
  due_amount: number | null;
  days_outstanding: number | null;
};

function bucket(days: number | null): string {
  if (days == null) return "—";
  if (days <= 7) return "0-7 days";
  if (days <= 30) return "8-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

export default async function ARReport() {
  const supa = db();
  const { data } = await supa
    .from("job_360")
    .select("hcp_job_id, hcp_customer_id, customer_name, invoice_number, job_date, tech_primary_name, due_amount, days_outstanding")
    .gt("due_amount", 0)
    .order("days_outstanding", { ascending: false, nullsFirst: false })
    .limit(500);
  const rows = (data ?? []) as ARRow[];

  // Aging summary
  const buckets: Record<string, { count: number; total: number }> = {
    "0-7 days": { count: 0, total: 0 },
    "8-30 days": { count: 0, total: 0 },
    "31-60 days": { count: 0, total: 0 },
    "61-90 days": { count: 0, total: 0 },
    "90+ days": { count: 0, total: 0 },
  };
  let grandTotal = 0;
  for (const r of rows) {
    const b = bucket(r.days_outstanding);
    if (buckets[b]) {
      buckets[b].count += 1;
      buckets[b].total += Number(r.due_amount) || 0;
    }
    grandTotal += Number(r.due_amount) || 0;
  }

  const columns: Column<ARRow>[] = [
    { header: "Date", cell: (r) => fmtDateShort(r.job_date), className: "text-neutral-600" },
    { header: "Invoice", cell: (r) => r.invoice_number ?? "—", className: "font-mono text-xs" },
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
    { header: "Tech", cell: (r) => r.tech_primary_name ?? "—" },
    { header: "Due", cell: (r) => <span className="font-medium text-red-700">{fmtMoney(r.due_amount)}</span>, align: "right" },
    {
      header: "Days out",
      cell: (r) => (
        <span className={(r.days_outstanding ?? 0) > 30 ? "font-medium text-red-700" : "text-neutral-700"}>
          {r.days_outstanding ?? "—"}d
        </span>
      ),
      align: "right",
    },
    { header: "Aging", cell: (r) => bucket(r.days_outstanding), className: "text-xs text-neutral-500" },
  ];

  return (
    <PageShell
      title="Receivables"
      description={`${rows.length} open invoice${rows.length === 1 ? "" : "s"} totaling ${fmtMoney(grandTotal)} outstanding.`}
    >
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {Object.entries(buckets).map(([label, v]) => (
          <div key={label} className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium text-neutral-500">{label}</div>
            <div className="mt-1 text-xl font-semibold text-neutral-900">{fmtMoney(v.total)}</div>
            <div className="text-xs text-neutral-500">{v.count} invoice{v.count === 1 ? "" : "s"}</div>
          </div>
        ))}
      </section>

      <Table
        columns={columns}
        rows={rows}
        rowHref={(r) => (r.hcp_job_id ? `/job/${r.hcp_job_id}` : null)}
        emptyText="No outstanding invoices."
      />
    </PageShell>
  );
}
