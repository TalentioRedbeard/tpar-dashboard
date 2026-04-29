// Search page — find customers, jobs, communications by name / phone / id / topic
import { db } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SearchProps = {
  searchParams: Promise<{ q?: string }>;
};

async function loadResults(q: string) {
  if (!q) return { customers: [], jobs: [], comms: [] };
  const supabase = db();
  const phone = q.replace(/\D/g, "").slice(-10);
  const isPhone = phone.length === 10;
  const isCustId = q.startsWith("cus_");
  const isJobId = q.startsWith("job_");
  const isInvoice = /^\d{6,}/.test(q);

  // Customers: by hcp_customer_id, name, or phone
  let custQ = supabase
    .from("customer_360")
    .select("hcp_customer_id, name, phone_mobile10, phone10, lifetime_job_count, open_followups, lifetime_paid_revenue_dollars, outstanding_due_dollars, comm_count_90d")
    .limit(15);
  if (isCustId) custQ = custQ.eq("hcp_customer_id", q);
  else if (isPhone) custQ = custQ.or(`phone10.eq.${phone},phone_mobile10.eq.${phone}`);
  else custQ = custQ.ilike("name", `%${q}%`);

  // Jobs: by hcp_job_id, invoice_number, or customer_name
  let jobQ = supabase
    .from("job_360")
    .select("hcp_job_id, customer_name, tech_primary_name, job_date, revenue, gross_margin_pct, gps_matched, time_on_site_minutes, on_time, invoice_number")
    .order("job_date", { ascending: false, nullsFirst: false })
    .limit(15);
  if (isJobId) jobQ = jobQ.eq("hcp_job_id", q);
  else if (isInvoice) jobQ = jobQ.or(`invoice_number.eq.${q},invoice_number.ilike.${q}-%`);
  else jobQ = jobQ.ilike("customer_name", `%${q}%`);

  // Comms: by content / customer_name / counterparty
  const commsQ = supabase
    .from("communication_events")
    .select("id, occurred_at, channel, direction, customer_name, hcp_customer_id, tech_short_name, importance, sentiment, summary")
    .or(`customer_name.ilike.%${q}%,counterparty.ilike.%${q}%,summary.ilike.%${q}%`)
    .order("occurred_at", { ascending: false })
    .limit(20);

  const [c, j, m] = await Promise.all([custQ, jobQ, commsQ]);
  return {
    customers: c.data ?? [],
    jobs: j.data ?? [],
    comms: m.data ?? [],
    error: c.error?.message ?? j.error?.message ?? m.error?.message,
  };
}

export default async function SearchPage({ searchParams }: SearchProps) {
  const { q = "" } = await searchParams;
  const results = q ? await loadResults(q) : null;

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">← Today</Link>
        <h1 className="text-3xl font-bold mt-2">Search</h1>
      </div>

      <form className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Customer name, phone, hcp_customer_id, hcp_job_id, invoice number, or content keyword"
          className="flex-1 px-3 py-2 rounded border border-zinc-300 focus:outline-none focus:border-zinc-500"
          autoFocus
        />
        <button type="submit" className="px-4 py-2 bg-zinc-900 text-white rounded hover:bg-zinc-700">Search</button>
      </form>

      {!q && (
        <div className="text-sm text-zinc-500">
          <p>Try:</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><code className="bg-zinc-100 px-1 rounded">Petrovich</code> — by name</li>
            <li><code className="bg-zinc-100 px-1 rounded">9182371234</code> — by phone (10 digits)</li>
            <li><code className="bg-zinc-100 px-1 rounded">27665535</code> — by invoice number</li>
            <li><code className="bg-zinc-100 px-1 rounded">cus_18d1eb20...</code> — by HCP customer id</li>
            <li><code className="bg-zinc-100 px-1 rounded">leak</code> — by topic in summaries</li>
          </ul>
        </div>
      )}

      {results?.error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">DB error: {results.error}</div>
      )}

      {results && (
        <>
          <section>
            <h2 className="text-lg font-semibold mb-2">Customers ({results.customers.length})</h2>
            {results.customers.length > 0 ? (
              <ul className="space-y-1">
                {results.customers.map((c: Record<string, unknown>) => (
                  <li key={c.hcp_customer_id as string} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">
                    <Link href={`/customer/${c.hcp_customer_id}`} className="font-medium hover:underline">{c.name as string ?? c.hcp_customer_id}</Link>
                    <div className="text-xs text-zinc-500">
                      {(c.lifetime_job_count as number) ?? 0} jobs ·
                      ${Number(c.lifetime_paid_revenue_dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })} paid ·
                      {(c.open_followups as number) ?? 0} open follow-ups ·
                      {(c.comm_count_90d as number) ?? 0} comms 90d
                      {Number(c.outstanding_due_dollars) > 0 && <span className="text-red-700"> · ${Number(c.outstanding_due_dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })} outstanding</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-500">No matches.</p>}
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Jobs ({results.jobs.length})</h2>
            {results.jobs.length > 0 ? (
              <ul className="space-y-1">
                {results.jobs.map((j: Record<string, unknown>) => (
                  <li key={j.hcp_job_id as string} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">
                    <Link href={`/job/${j.hcp_job_id}`} className="font-medium hover:underline">
                      {j.customer_name as string ?? "(no name)"}{j.invoice_number ? ` · #${j.invoice_number as string}` : ""}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      {(j.job_date as string) ?? "no date"} · {(j.tech_primary_name as string) ?? "—"}
                      {j.revenue != null && ` · $${Number(j.revenue).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      {j.gross_margin_pct != null && ` · ${Number(j.gross_margin_pct).toFixed(0)}% margin`}
                      {!!j.gps_matched && ` · GPS ${j.on_time ? "on-time" : "late"} · ${j.time_on_site_minutes as number ?? "—"}min`}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-500">No matches.</p>}
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Communications ({results.comms.length})</h2>
            {results.comms.length > 0 ? (
              <ul className="space-y-1">
                {results.comms.map((m: Record<string, unknown>) => (
                  <li key={m.id as number} className="border border-zinc-200 rounded p-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                      <span className="font-mono">{new Date(m.occurred_at as string).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}</span>
                      <span>·</span>
                      <span>{m.channel as string}</span>
                      {!!m.direction && <><span>·</span><span>{m.direction as string}</span></>}
                      {!!m.tech_short_name && <><span>·</span><span>{m.tech_short_name as string}</span></>}
                      <span className="ml-auto">imp {m.importance as number ?? "—"}</span>
                    </div>
                    <p className="text-sm">
                      <strong>{m.hcp_customer_id ? <Link href={`/customer/${m.hcp_customer_id}`} className="hover:underline">{m.customer_name as string ?? "(no name)"}</Link> : (m.customer_name as string ?? "(no name)")}:</strong>{" "}
                      {m.summary as string}
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-500">No matches.</p>}
          </section>
        </>
      )}
    </main>
  );
}
