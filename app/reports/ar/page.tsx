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

  // AR concentration: aggregate by customer to surface pareto risk.
  // Pure aggregation — no inference.
  const byCustomer = new Map<string, {
    name: string;
    customerId: string | null;
    invoiceCount: number;
    totalDue: number;
    maxDays: number;
    oldestInvoice: string | null;
  }>();
  for (const r of rows) {
    const key = r.hcp_customer_id ?? `anon:${r.customer_name ?? "?"}`;
    const existing = byCustomer.get(key);
    const due = Number(r.due_amount) || 0;
    const days = r.days_outstanding ?? 0;
    if (existing) {
      existing.invoiceCount += 1;
      existing.totalDue += due;
      existing.maxDays = Math.max(existing.maxDays, days);
    } else {
      byCustomer.set(key, {
        name: r.customer_name ?? "—",
        customerId: r.hcp_customer_id,
        invoiceCount: 1,
        totalDue: due,
        maxDays: days,
        oldestInvoice: r.invoice_number,
      });
    }
  }
  const customerRows = [...byCustomer.values()].sort((a, b) => b.totalDue - a.totalDue);
  const top10 = customerRows.slice(0, 10);
  const top10Total = top10.reduce((s, c) => s + c.totalDue, 0);
  const top10Pct = grandTotal > 0 ? (top10Total / grandTotal) * 100 : 0;

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
      actions={
        <a
          href="/reports/ar/export.csv"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Download CSV
        </a>
      }
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

      <section className="mb-8">
        <header className="mb-2">
          <h2 className="text-base font-semibold text-neutral-900">Top customers holding AR</h2>
          <p className="text-xs text-neutral-500">
            {customerRows.length} distinct customer{customerRows.length === 1 ? "" : "s"} with open AR · top 10 hold{" "}
            <strong>{fmtMoney(top10Total)}</strong> ({top10Pct.toFixed(1)}% of total). Pure aggregation.
          </p>
        </header>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-neutral-600">Customer</th>
                <th className="px-4 py-2 text-right font-medium text-neutral-600">Invoices</th>
                <th className="px-4 py-2 text-right font-medium text-neutral-600">Total due</th>
                <th className="px-4 py-2 text-right font-medium text-neutral-600">% of AR</th>
                <th className="px-4 py-2 text-right font-medium text-neutral-600">Oldest (days)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {top10.map((c) => {
                const pct = grandTotal > 0 ? (c.totalDue / grandTotal) * 100 : 0;
                return (
                  <tr key={c.customerId ?? c.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 align-top">
                      {c.customerId ? (
                        <Link href={`/customer/${c.customerId}`} className="font-medium text-neutral-900 hover:underline">{c.name}</Link>
                      ) : (
                        <span className="font-medium text-neutral-900">{c.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{c.invoiceCount}</td>
                    <td className="px-4 py-2 text-right font-medium text-red-700">{fmtMoney(c.totalDue)}</td>
                    <td className="px-4 py-2 text-right text-neutral-700">{pct.toFixed(1)}%</td>
                    <td className={`px-4 py-2 text-right ${c.maxDays > 60 ? "font-medium text-red-700" : "text-neutral-700"}`}>{c.maxDays}d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <h2 className="mb-2 text-base font-semibold text-neutral-900">All open invoices ({rows.length})</h2>
      <Table
        columns={columns}
        rows={rows}
        rowHref={(r) => (r.hcp_job_id ? `/job/${r.hcp_job_id}` : null)}
        emptyText="No outstanding invoices."
      />
    </PageShell>
  );
}
