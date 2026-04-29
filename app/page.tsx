// Today — operations review surface.
// Server component; reads communication_events + customer_360 + job_360 directly via service_role.

import { db } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

type FollowupRow = {
  id: number;
  occurred_at: string;
  channel: string;
  direction: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  tech_short_name: string | null;
  importance: number | null;
  sentiment: string | null;
  flags: string[] | null;
  summary: string | null;
};

type CustomerLeader = {
  hcp_customer_id: string;
  name: string | null;
  open_followups: number;
  comm_count_90d: number;
  lifetime_paid_revenue_dollars: number;
  outstanding_due_dollars: number;
};

type RecentJob = {
  hcp_job_id: string;
  customer_name: string | null;
  tech_primary_name: string | null;
  job_date: string | null;
  revenue: number | null;
  gross_margin_pct: number | null;
  gps_matched: boolean | null;
  time_on_site_minutes: number | null;
  on_time: boolean | null;
};

async function loadData() {
  const supabase = db();
  const since14d = new Date(Date.now() - 14 * 86400_000).toISOString();
  const sinceJobs = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  const [followupsRes, leadersRes, recentJobsRes] = await Promise.all([
    supabase
      .from("communication_events")
      .select("id, occurred_at, channel, direction, customer_name, hcp_customer_id, tech_short_name, importance, sentiment, flags, summary")
      .gte("occurred_at", since14d)
      .or("flags.cs.{needs_followup},flags.cs.{unresolved},flags.cs.{escalation_needed}")
      .gte("importance", 5)
      .order("importance", { ascending: false, nullsFirst: false })
      .order("occurred_at", { ascending: false })
      .limit(20),
    supabase
      .from("customer_360")
      .select("hcp_customer_id, name, open_followups, comm_count_90d, lifetime_paid_revenue_dollars, outstanding_due_dollars")
      .gt("open_followups", 0)
      .order("open_followups", { ascending: false })
      .limit(15),
    supabase
      .from("job_360")
      .select("hcp_job_id, customer_name, tech_primary_name, job_date, revenue, gross_margin_pct, gps_matched, time_on_site_minutes, on_time")
      .gte("job_date", sinceJobs)
      .order("job_date", { ascending: false })
      .limit(20),
  ]);

  return {
    followups: (followupsRes.data ?? []) as FollowupRow[],
    leaders: (leadersRes.data ?? []) as CustomerLeader[],
    recentJobs: (recentJobsRes.data ?? []) as RecentJob[],
    error: followupsRes.error?.message || leadersRes.error?.message || recentJobsRes.error?.message,
  };
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "red" | "amber" | "green" | "neutral" }) {
  const cls =
    tone === "red"   ? "bg-red-100 text-red-800 ring-red-200" :
    tone === "amber" ? "bg-amber-100 text-amber-900 ring-amber-200" :
    tone === "green" ? "bg-green-100 text-green-800 ring-green-200" :
                       "bg-zinc-100 text-zinc-700 ring-zinc-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ring-1 ring-inset ${cls}`}>{children}</span>;
}

export default async function Today() {
  const { followups, leaders, recentJobs, error } = await loadData();

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">TPAR — Today</h1>
        <div className="flex items-center gap-3">
          <Link href="/search" className="text-sm text-zinc-700 hover:underline">Search →</Link>
          <p className="text-sm text-zinc-500">{new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CT</p>
        </div>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">DB error: {error}</div>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-3">Open follow-ups (last 14d, importance ≥ 5)</h2>
        {followups.length === 0 ? (
          <p className="text-sm text-zinc-500">No open follow-ups in window.</p>
        ) : (
          <ul className="space-y-2">
            {followups.map((f) => (
              <li key={f.id} className="rounded border border-zinc-200 p-3 hover:bg-zinc-50">
                <div className="flex items-start gap-2 mb-1 flex-wrap">
                  <Pill tone={f.importance != null && f.importance >= 8 ? "red" : f.importance != null && f.importance >= 6 ? "amber" : "neutral"}>
                    imp {f.importance ?? "—"}
                  </Pill>
                  <Pill>{f.channel}</Pill>
                  {f.direction && <Pill>{f.direction}</Pill>}
                  <Pill tone={f.sentiment === "negative" ? "red" : f.sentiment === "positive" ? "green" : "neutral"}>
                    {f.sentiment ?? "—"}
                  </Pill>
                  <span className="text-xs text-zinc-500 ml-auto">
                    {new Date(f.occurred_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="font-medium">
                    {f.hcp_customer_id ? (
                      <Link href={`/customer/${f.hcp_customer_id}`} className="hover:underline">
                        {f.customer_name ?? "(no name)"}
                      </Link>
                    ) : (f.customer_name ?? "(no name)")}
                  </span>
                  {f.tech_short_name && <span className="text-zinc-500"> · {f.tech_short_name}</span>}
                </div>
                <p className="text-sm text-zinc-700 mt-1">{f.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Customers by open follow-ups</h2>
        {leaders.length === 0 ? (
          <p className="text-sm text-zinc-500">No customer has open follow-ups.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500 border-b">
                <tr>
                  <th className="py-2">Customer</th>
                  <th className="py-2 text-right">Open</th>
                  <th className="py-2 text-right">Comms 90d</th>
                  <th className="py-2 text-right">Paid LTD</th>
                  <th className="py-2 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((c) => (
                  <tr key={c.hcp_customer_id} className="border-b last:border-0 hover:bg-zinc-50">
                    <td className="py-2">
                      <Link href={`/customer/${c.hcp_customer_id}`} className="font-medium hover:underline">
                        {c.name ?? c.hcp_customer_id}
                      </Link>
                    </td>
                    <td className="py-2 text-right">
                      <Pill tone={c.open_followups >= 5 ? "red" : c.open_followups >= 3 ? "amber" : "neutral"}>
                        {c.open_followups}
                      </Pill>
                    </td>
                    <td className="py-2 text-right">{c.comm_count_90d}</td>
                    <td className="py-2 text-right">${Number(c.lifetime_paid_revenue_dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="py-2 text-right">
                      {Number(c.outstanding_due_dollars) > 0 ? (
                        <span className="text-red-700">${Number(c.outstanding_due_dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Recent jobs (last 7d)</h2>
        {recentJobs.length === 0 ? (
          <p className="text-sm text-zinc-500">No jobs in window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500 border-b">
                <tr>
                  <th className="py-2">Date</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2">Tech</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">Margin</th>
                  <th className="py-2">GPS</th>
                  <th className="py-2">On-time</th>
                  <th className="py-2 text-right">Min on site</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((j) => (
                  <tr key={j.hcp_job_id} className="border-b last:border-0 hover:bg-zinc-50">
                    <td className="py-2 whitespace-nowrap">{j.job_date ?? "—"}</td>
                    <td className="py-2"><Link href={`/job/${j.hcp_job_id}`} className="hover:underline">{j.customer_name ?? "(no name)"}</Link></td>
                    <td className="py-2">{j.tech_primary_name ?? "—"}</td>
                    <td className="py-2 text-right">{j.revenue != null ? `$${Number(j.revenue).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</td>
                    <td className="py-2 text-right">{j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"}</td>
                    <td className="py-2">{j.gps_matched ? <Pill tone="green">yes</Pill> : <Pill tone="neutral">no</Pill>}</td>
                    <td className="py-2">{j.on_time === true ? <Pill tone="green">on</Pill> : j.on_time === false ? <Pill tone="amber">late</Pill> : <Pill>—</Pill>}</td>
                    <td className="py-2 text-right">{j.time_on_site_minutes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="pt-6 border-t text-xs text-zinc-500">
        TPAR-DB Dashboard · v0 · server-rendered from job_360 / customer_360 / communication_events
      </footer>
    </main>
  );
}
