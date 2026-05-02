// Today — operations review surface. Server component; reads
// communication_events + customer_360 + job_360 directly via service_role.

import { db } from "@/lib/supabase";
import Link from "next/link";
import { AckButton } from "../components/AckButton";
import { ClockButton } from "../components/ClockButton";
import { PageShell } from "../components/PageShell";
import { Section } from "../components/ui/Section";
import { Pill } from "../components/ui/Pill";
import { EmptyState } from "../components/ui/EmptyState";
import { TechName } from "../components/ui/TechName";
import { getCurrentTech } from "../lib/current-tech";
import { getFormerTechNames } from "../lib/former-techs";
import { getCurrentState as getClockState } from "./time/actions";

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
  acked_at: string | null;
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

type PatternFlag = {
  hcp_customer_id: string;
  customer_name: string | null;
  job_count_12mo: number;
  span_days: number;
  total_revenue_12mo: number;
};

type TodayAppt = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  scheduled_start: string;
  customer_name: string | null;
  tech_primary_name: string | null;
  status: string | null;
  street: string | null;
  city: string | null;
};

async function loadData() {
  const supabase = db();
  const since14d = new Date(Date.now() - 14 * 86400_000).toISOString();
  const sinceJobs = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const todayStart = new Date(`${todayKey}T00:00:00-05:00`).toISOString();
  const todayEnd   = new Date(`${todayKey}T23:59:59-05:00`).toISOString();

  const [followupsRes, leadersRes, recentJobsRes, patternsRes, arRes, todayApptsRes] = await Promise.all([
    supabase
      .from("communication_events")
      .select("id, occurred_at, channel, direction, customer_name, hcp_customer_id, tech_short_name, importance, sentiment, flags, summary, acked_at")
      .gte("occurred_at", since14d)
      .or("flags.cs.{needs_followup},flags.cs.{unresolved},flags.cs.{escalation_needed}")
      .gte("importance", 5)
      .is("acked_at", null)
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
    supabase
      .from("customer_repeat_jobs_v")
      .select("hcp_customer_id, customer_name, job_count_12mo, span_days, total_revenue_12mo")
      .eq("preventative_candidate", true)
      .order("job_count_12mo", { ascending: false })
      .limit(5),
    supabase
      .from("job_360")
      .select("hcp_customer_id, customer_name, due_amount, days_outstanding")
      .gt("due_amount", 0)
      .order("due_amount", { ascending: false })
      .limit(50),
    supabase
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, scheduled_start, customer_name, tech_primary_name, status, street, city")
      .gte("scheduled_start", todayStart)
      .lte("scheduled_start", todayEnd)
      // Hide cancelled — they aren't on the books
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled")')
      // Hide internal "TPAR" jobs — same filter the /jobs and /customers list pages apply
      .not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")')
      .order("scheduled_start", { ascending: true }),
  ]);

  const arByCustomer = new Map<string, { name: string; total: number; oldest: number }>();
  for (const r of (arRes.data ?? []) as Array<Record<string, unknown>>) {
    const key = (r.hcp_customer_id as string) ?? `anon:${r.customer_name}`;
    const existing = arByCustomer.get(key);
    const due = Number(r.due_amount) || 0;
    const days = Number(r.days_outstanding) || 0;
    if (existing) {
      existing.total += due;
      existing.oldest = Math.max(existing.oldest, days);
    } else {
      arByCustomer.set(key, {
        name: (r.customer_name as string) ?? "—",
        total: due,
        oldest: days,
      });
    }
  }
  const arTop = [...arByCustomer.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([id, v]) => ({ hcp_customer_id: id.startsWith("anon:") ? null : id, ...v }));

  const todayAppts = (todayApptsRes.data ?? []) as TodayAppt[];

  return {
    followups: (followupsRes.data ?? []) as FollowupRow[],
    leaders: (leadersRes.data ?? []) as CustomerLeader[],
    recentJobs: (recentJobsRes.data ?? []) as RecentJob[],
    patterns: (patternsRes.data ?? []) as PatternFlag[],
    arTop,
    todayAppts,
    error: followupsRes.error?.message || leadersRes.error?.message || recentJobsRes.error?.message,
  };
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export default async function Today() {
  const { followups, leaders, recentJobs, patterns, arTop, todayAppts, error } = await loadData();
  const me = await getCurrentTech().catch(() => null);
  const canWrite = !!me?.canWrite;
  const formerSet = await getFormerTechNames();
  const clockState = me?.tech ? await getClockState().catch(() => null) : null;

  // Next upcoming wake-up alarm (admin/manager view only — techs don't manage alarms)
  let nextAlarm: { name: string; fire_at: string; tier: string } | null = null;
  if (me?.isAdmin || me?.isManager) {
    const supaA = db();
    const { data: na } = await supaA
      .from("wake_up_alarms")
      .select("name, fire_at, requirement_level")
      .eq("active", true)
      .in("status", ["pending", "firing"])
      .gte("fire_at", new Date().toISOString())
      .order("fire_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (na) nextAlarm = { name: na.name as string, fire_at: na.fire_at as string, tier: na.requirement_level as string };
  }
  const apptCount = todayAppts.length;
  const techCount = new Set(todayAppts.map((a) => a.tech_primary_name).filter(Boolean)).size;
  const firstAppt = todayAppts[0]?.scheduled_start ? fmtTime(todayAppts[0].scheduled_start) : null;
  const nowLabel = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <PageShell
      kicker="Operations · Live"
      title="Today at TPAR"
      description={`${nowLabel} · Tulsa, OK · Central Time`}
      actions={
        <Link
          href="/dispatch"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Open dispatch →
        </Link>
      }
    >
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          DB error: {error}
        </div>
      )}

      {clockState && me?.tech && (
        <section className="mb-6">
          <ClockButton
            initial={clockState}
            techShortName={me.tech.tech_short_name}
          />
        </section>
      )}

      {nextAlarm && (() => {
        const ms = new Date(nextAlarm.fire_at).getTime() - Date.now();
        const abs = Math.abs(ms);
        const hr = Math.floor(abs / 3_600_000);
        const min = Math.floor((abs % 3_600_000) / 60_000);
        const inLabel = hr > 0 ? `${hr}h ${min}m` : `${min}m`;
        const fireFmt = new Date(nextAlarm.fire_at).toLocaleString("en-US", {
          timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true,
        });
        return (
          <Link href="/alarms" className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm transition hover:bg-amber-50">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
            <span className="font-medium text-amber-900">Next wake-up alarm</span>
            <span className="text-amber-800">{nextAlarm.name}</span>
            <span className="text-xs text-amber-700">tier {nextAlarm.tier}</span>
            <span className="ml-auto text-xs text-amber-800">fires {fireFmt} <span className="text-amber-600">(in {inLabel})</span></span>
          </Link>
        );
      })()}

      {/* Hero strip — three pulse cards */}
      <section className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Today on the books */}
        <div className="group relative overflow-hidden rounded-2xl border border-brand-200/80 bg-gradient-to-br from-brand-50 to-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand-200/30 blur-2xl" />
          <div className="relative mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-800">On the books</h2>
            <Link href="/dispatch" className="text-xs font-medium text-brand-700 hover:underline">All →</Link>
          </div>
          {apptCount === 0 ? (
            <p className="relative text-sm text-brand-900/80">No appointments scheduled today.</p>
          ) : (
            <>
              <div className="relative flex items-baseline gap-2">
                <span className="text-4xl font-semibold leading-none tabular-nums tracking-tight text-brand-900">{apptCount}</span>
                <span className="text-sm text-brand-900/70">appt{apptCount === 1 ? "" : "s"}</span>
              </div>
              <div className="relative mt-1.5 text-xs text-brand-900/70">
                {techCount} tech{techCount === 1 ? "" : "s"}{firstAppt ? ` · first ${firstAppt}` : ""}
              </div>
              <ul className="relative mt-4 space-y-1 border-t border-brand-200/70 pt-3 text-xs text-brand-900">
                {todayAppts.slice(0, 4).map((a) => (
                  <li key={a.appointment_id ?? a.hcp_job_id ?? a.scheduled_start} className="flex gap-2">
                    <span className="w-12 shrink-0 font-mono tabular-nums text-brand-700">{fmtTime(a.scheduled_start)}</span>
                    <span className="flex-1 truncate">
                      {a.hcp_job_id ? (
                        <Link href={`/job/${a.hcp_job_id}`} className="font-medium hover:underline">{a.customer_name ?? "—"}</Link>
                      ) : (
                        <span className="font-medium">{a.customer_name ?? "—"}</span>
                      )}
                      <span className="text-brand-900/60"> · <TechName name={a.tech_primary_name} formerSet={formerSet} /></span>
                    </span>
                  </li>
                ))}
                {apptCount > 4 ? (
                  <li className="text-brand-700/70">+{apptCount - 4} more →</li>
                ) : null}
              </ul>
            </>
          )}
        </div>

        {/* Pattern signals */}
        <div className="group relative overflow-hidden rounded-2xl border border-accent-100 bg-gradient-to-br from-accent-50 to-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent-100/40 blur-2xl" />
          <div className="relative mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-700">Preventative candidates</h2>
            <Link href="/reports/patterns" className="text-xs font-medium text-accent-700 hover:underline">All →</Link>
          </div>
          {patterns.length === 0 ? (
            <p className="relative text-sm text-accent-700/80">No patterns flagged today.</p>
          ) : (
            <>
              <div className="relative flex items-baseline gap-2">
                <span className="text-4xl font-semibold leading-none tabular-nums tracking-tight text-accent-700">{patterns.length}</span>
                <span className="text-sm text-accent-700/80">customer{patterns.length === 1 ? "" : "s"}</span>
              </div>
              <ul className="relative mt-4 space-y-1 border-t border-accent-100 pt-3 text-xs">
                {patterns.map((p) => (
                  <li key={p.hcp_customer_id} className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/customer/${p.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                      {p.customer_name ?? "—"}
                    </Link>
                    <span className="text-accent-700 tabular-nums">
                      {p.job_count_12mo} jobs / {p.span_days}d
                    </span>
                    <span className="text-neutral-500">·</span>
                    <span className="text-neutral-600 tabular-nums">{fmtMoney(p.total_revenue_12mo)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Top open AR */}
        <div className="group relative overflow-hidden rounded-2xl border border-red-200/80 bg-gradient-to-br from-red-50 to-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-red-200/30 blur-2xl" />
          <div className="relative mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-red-700">Top open AR</h2>
            <Link href="/reports/ar" className="text-xs font-medium text-red-700 hover:underline">All →</Link>
          </div>
          {arTop.length === 0 ? (
            <p className="relative text-sm text-red-800/80">No open AR.</p>
          ) : (
            <>
              <div className="relative flex items-baseline gap-2">
                <span className="text-4xl font-semibold leading-none tabular-nums tracking-tight text-red-700">
                  {fmtMoney(arTop.reduce((s, a) => s + a.total, 0))}
                </span>
                <span className="text-sm text-red-700/80">across {arTop.length}</span>
              </div>
              <ul className="relative mt-4 space-y-1 border-t border-red-200 pt-3 text-xs">
                {arTop.map((a) => (
                  <li key={a.hcp_customer_id ?? a.name} className="flex flex-wrap items-baseline gap-x-2">
                    {a.hcp_customer_id ? (
                      <Link href={`/customer/${a.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">{a.name}</Link>
                    ) : (
                      <span className="font-medium text-neutral-900">{a.name}</span>
                    )}
                    <span className="text-red-700 tabular-nums">{fmtMoney(a.total)}</span>
                    {a.oldest > 0 ? (
                      <span className="text-neutral-500">· {a.oldest}d</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <div className="space-y-10">
        <Section
          title="Open follow-ups"
          description="Calls & texts in the last 14 days flagged for follow-up at importance ≥ 5."
        >
          {followups.length === 0 ? (
            <EmptyState title="All caught up." description="No open follow-ups in window." />
          ) : (
            <ul className="space-y-2">
              {followups.map((f) => (
                <li key={f.id} className="rounded-2xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Pill tone={f.importance != null && f.importance >= 8 ? "red" : f.importance != null && f.importance >= 6 ? "amber" : "neutral"}>
                      imp {f.importance ?? "—"}
                    </Pill>
                    <Pill tone="slate">{f.channel}</Pill>
                    {f.direction ? <Pill tone="slate">{f.direction}</Pill> : null}
                    {f.sentiment ? (
                      <Pill tone={f.sentiment === "negative" ? "red" : f.sentiment === "positive" ? "green" : "neutral"}>
                        {f.sentiment}
                      </Pill>
                    ) : null}
                    <span className="ml-auto text-xs text-neutral-500">
                      {new Date(f.occurred_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <AckButton commId={f.id} acked={!!f.acked_at} canWrite={canWrite} />
                  </div>
                  <div className="text-sm">
                    {f.hcp_customer_id ? (
                      <Link href={`/customer/${f.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                        {f.customer_name ?? "(no name)"}
                      </Link>
                    ) : (
                      <span className="font-medium text-neutral-900">{f.customer_name ?? "(no name)"}</span>
                    )}
                    {f.tech_short_name ? <span className="text-neutral-500"> · {f.tech_short_name}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-neutral-700">{f.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Customers by open follow-ups"
          description="Where the unresolved threads cluster. Click through to see the conversation history."
        >
          {leaders.length === 0 ? (
            <EmptyState title="No customer has open follow-ups." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Customer</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Open</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Comms 90d</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Paid LTD</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {leaders.map((c) => (
                    <tr key={c.hcp_customer_id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2">
                        <Link href={`/customer/${c.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                          {c.name ?? c.hcp_customer_id}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Pill tone={c.open_followups >= 5 ? "red" : c.open_followups >= 3 ? "amber" : "neutral"}>
                          {c.open_followups}
                        </Pill>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{c.comm_count_90d}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{fmtMoney(c.lifetime_paid_revenue_dollars)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {Number(c.outstanding_due_dollars) > 0 ? (
                          <span className="font-medium text-red-700">{fmtMoney(c.outstanding_due_dollars)}</span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title="Recent jobs"
          description="The last seven days of completed and in-progress jobs."
        >
          {recentJobs.length === 0 ? (
            <EmptyState title="No jobs in window." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Date</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Customer</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Tech</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Revenue</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Margin</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">GPS</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">On-time</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Min on site</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {recentJobs.map((j) => (
                    <tr key={j.hcp_job_id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 whitespace-nowrap text-neutral-600">{j.job_date ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Link href={`/job/${j.hcp_job_id}`} className="font-medium text-neutral-900 hover:underline">
                          {j.customer_name ?? "(no name)"}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-neutral-700"><TechName name={j.tech_primary_name} formerSet={formerSet} /></td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{fmtMoney(j.revenue)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"}</td>
                      <td className="px-4 py-2">{j.gps_matched ? <Pill tone="green">yes</Pill> : <Pill tone="slate">no</Pill>}</td>
                      <td className="px-4 py-2">
                        {j.on_time === true ? <Pill tone="green">on</Pill> : j.on_time === false ? <Pill tone="amber">late</Pill> : <Pill>—</Pill>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{j.time_on_site_minutes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        <span>TPAR-DB · live operational substrate</span>
        <span className="font-mono text-[10px] text-neutral-400">
          job_360 · customer_360 · communication_events
        </span>
      </footer>
    </PageShell>
  );
}
