// /admin/ar — open accounts receivable, oldest first.
//
// Came out of the 2026-05-14 variance audit which found ~$38k sitting in
// open/pending_payment invoices on completed jobs. Madisson's collection
// workflow lives here: oldest at the top, customer + amount + days since
// invoice, click to drill into the job.
//
// Admin + manager only (it's a money screen).

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { fmtMoney } from "../../../components/Table";
import { getCurrentTech } from "../../../lib/current-tech";

export const metadata = { title: "Open AR · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type ArRow = {
  hcp_invoice_id: string;
  hcp_job_id: string | null;
  invoice_number: string | null;
  status: string | null;
  amount: number;
  due_amount: number | null;
  invoice_date: string | null;
  due_at: string | null;
  sent_at: string | null;
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function ageTone(days: number | null): string {
  if (days == null) return "bg-neutral-100 text-neutral-700";
  if (days >= 60) return "bg-red-100 text-red-800";
  if (days >= 30) return "bg-amber-100 text-amber-800";
  if (days >= 14) return "bg-yellow-50 text-yellow-800";
  return "bg-neutral-100 text-neutral-700";
}

export default async function OpenArPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/ar");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const supa = db();

  // Pull open + pending_payment invoices, last 180 days (anything older is likely write-off territory).
  const { data: invoices } = await supa
    .from("hcp_invoices_by_job")
    .select("hcp_invoice_id, hcp_job_id, invoice_number, status, amount, due_amount, invoice_date, due_at, sent_at")
    .in("status", ["open", "pending_payment"])
    .gte("invoice_date", new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10))
    .order("invoice_date", { ascending: true })
    .limit(500);

  const rows = (invoices ?? []) as ArRow[];

  // Pull customer names via the jobs that own these invoices.
  const jobIds = Array.from(new Set(rows.map((r) => r.hcp_job_id).filter(Boolean) as string[]));
  let customerByJob = new Map<string, { customer_name: string | null; hcp_customer_id: string | null; tech_primary_name: string | null }>();
  if (jobIds.length > 0) {
    const { data: jobs } = await supa
      .from("appointments_master")
      .select("hcp_job_id, customer_name, hcp_customer_id, tech_primary_name")
      .in("hcp_job_id", jobIds);
    for (const j of (jobs ?? []) as Array<{ hcp_job_id: string; customer_name: string | null; hcp_customer_id: string | null; tech_primary_name: string | null }>) {
      if (!customerByJob.has(j.hcp_job_id)) customerByJob.set(j.hcp_job_id, j);
    }
  }

  // Filter out test customers (defensive — invoice mirror generally doesn't see them)
  const testCustomers = new Set(["cus_9cf8cc5b02e1430a85288b034763cc19", "cus_386a644b8054483788825c86c1b13b9c"]);
  const visibleRows = rows.filter((r) => {
    if (!r.hcp_job_id) return true;
    const j = customerByJob.get(r.hcp_job_id);
    return !j?.hcp_customer_id || !testCustomers.has(j.hcp_customer_id);
  });

  const totalDollars = visibleRows.reduce((s, r) => s + (Number(r.due_amount ?? r.amount) || 0), 0) / 100;
  const totalCount = visibleRows.length;
  const over30Count = visibleRows.filter((r) => (daysSince(r.invoice_date) ?? 0) >= 30).length;
  const over60Count = visibleRows.filter((r) => (daysSince(r.invoice_date) ?? 0) >= 60).length;
  const over30Dollars = visibleRows
    .filter((r) => (daysSince(r.invoice_date) ?? 0) >= 30)
    .reduce((s, r) => s + (Number(r.due_amount ?? r.amount) || 0), 0) / 100;

  return (
    <PageShell
      kicker="Admin"
      title="Open accounts receivable"
      description={`${totalCount} unpaid invoice${totalCount === 1 ? "" : "s"} · ${fmtMoney(totalDollars)} total · ${over30Count} over 30 days (${fmtMoney(over30Dollars)})`}
      backHref="/dispatch"
      backLabel="Dispatch"
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">All open</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{fmtMoney(totalDollars)}</div>
          <div className="text-xs text-neutral-500">{totalCount} invoice{totalCount === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-3">
          <div className="text-xs uppercase tracking-wide text-yellow-700">14–29 days</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-yellow-900">
            {visibleRows.filter((r) => { const d = daysSince(r.invoice_date) ?? 0; return d >= 14 && d < 30; }).length}
          </div>
          <div className="text-xs text-yellow-700/80">first nudge</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs uppercase tracking-wide text-amber-700">30–59 days</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">{over30Count - over60Count}</div>
          <div className="text-xs text-amber-700/80">getting stale</div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
          <div className="text-xs uppercase tracking-wide text-red-700">60+ days</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-red-900">{over60Count}</div>
          <div className="text-xs text-red-700/80">collection priority</div>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No open AR. Either every invoice is paid or the filter is too narrow.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-neutral-600">Age</th>
                <th className="px-4 py-2 text-left font-medium text-neutral-600">Customer</th>
                <th className="px-4 py-2 text-left font-medium text-neutral-600">Tech</th>
                <th className="px-4 py-2 text-left font-medium text-neutral-600">Invoice</th>
                <th className="px-4 py-2 text-left font-medium text-neutral-600">Invoice date</th>
                <th className="px-4 py-2 text-left font-medium text-neutral-600">Status</th>
                <th className="px-4 py-2 text-right font-medium text-neutral-600">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visibleRows.map((r) => {
                const days = daysSince(r.invoice_date);
                const job = r.hcp_job_id ? customerByJob.get(r.hcp_job_id) : undefined;
                return (
                  <tr key={r.hcp_invoice_id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 align-top">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${ageTone(days)}`}>
                        {days == null ? "—" : `${days}d`}
                      </span>
                    </td>
                    <td className="px-4 py-2 align-top">
                      {job?.hcp_customer_id ? (
                        <Link href={`/customer/${job.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                          {job.customer_name ?? "—"}
                        </Link>
                      ) : (
                        <span className="font-medium text-neutral-900">{job?.customer_name ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top text-neutral-700">{job?.tech_primary_name ?? "—"}</td>
                    <td className="px-4 py-2 align-top text-neutral-700">
                      {r.hcp_job_id ? (
                        <Link href={`/job/${r.hcp_job_id}`} className="text-brand-700 hover:underline">
                          {r.invoice_number ?? r.hcp_invoice_id.slice(0, 12) + "…"}
                        </Link>
                      ) : (
                        r.invoice_number ?? r.hcp_invoice_id.slice(0, 12) + "…"
                      )}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-neutral-600">{r.invoice_date ?? "—"}</td>
                    <td className="px-4 py-2 align-top text-xs text-neutral-600">{r.status ?? "—"}</td>
                    <td className="px-4 py-2 align-top text-right font-medium text-neutral-900 tabular-nums">
                      {fmtMoney((Number(r.due_amount ?? r.amount) || 0) / 100)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-neutral-500">
        Source: hcp_invoices_by_job, status in (open, pending_payment), last 180 days.
        Click a customer or invoice to drill in. Aging buckets at 14 / 30 / 60 days.
      </p>
    </PageShell>
  );
}
