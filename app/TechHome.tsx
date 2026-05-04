// TechHome — the role-aware home view for techs.
// Per Danny 2026-05-04: "tech view should be dynamic, but limited to their
// jobs (past, present, and scheduled future). This scope limitation helps
// protect privacy and system security."
//
// Surface: clock state + today's MY appointments + quick action grid + recent
// MY jobs + upcoming MY jobs. No leadership-side widgets (AR, escalations,
// patterns). Mobile-first.

import Link from "next/link";
import type { CurrentTech } from "@/lib/current-tech";
import { db } from "@/lib/supabase";
import { getCurrentState as getClockState, type CurrentClockState } from "./time/actions";
import { ClockButton } from "../components/ClockButton";
import { PageShell } from "../components/PageShell";
import { Section } from "../components/ui/Section";
import { Pill } from "../components/ui/Pill";
import { EmptyState } from "../components/ui/EmptyState";

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });
}

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

interface TechAppt {
  appointment_id: string | null;
  hcp_job_id: string | null;
  scheduled_start: string;
  customer_name: string | null;
  street: string | null;
  city: string | null;
  status: string | null;
  tech_primary_name: string | null;
}

interface TechJob {
  hcp_job_id: string;
  customer_name: string | null;
  job_date: string | null;
  revenue: number | null;
  appointment_status: string | null;
}

interface TechComm {
  id: number;
  occurred_at: string;
  channel: string;
  direction: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  importance: number | null;
  summary: string | null;
  flags: string[] | null;
}

// Action tiles for tech — mode-aware "Estimate current job" tile flips state
// when clocked in vs. not. Same intent-first pattern as AdminHome.

export default async function TechHome({ me }: { me: CurrentTech }) {
  const supabase = db();
  const techName = me.tech?.tech_short_name;
  // appointments_master + job_360 store FULL names ("Omar Fernandez") in
  // tech_primary_name + tech_all_names. communication_events.tech_short_name
  // uses short names. Filter accordingly.
  const techFullName = me.tech?.hcp_full_name ?? me.tech?.tech_short_name ?? null;
  if (!techName || !techFullName) {
    return (
      <PageShell title="No tech profile" description="You're signed in but not linked to a tech_directory record.">
        <EmptyState title="Ask Danny to link your account." />
      </PageShell>
    );
  }

  // Date windows (Chicago time)
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const todayStart = new Date(`${todayKey}T00:00:00-05:00`).toISOString();
  const todayEnd   = new Date(`${todayKey}T23:59:59-05:00`).toISOString();
  const upcomingEnd = new Date(Date.now() + 14 * 86400_000).toISOString();
  const recentStart = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  // Clock state
  const clockState = await getClockState().catch(() => null);
  const clockedJobId = clockState && clockState.state === "clocked-in"
    ? (clockState as Extract<CurrentClockState, { state: "clocked-in" }>).hcp_job_id
    : null;

  // Mode-aware action tiles
  const tiles: Array<{
    label: string; emoji: string; href: string; primary?: boolean; subtitle?: string; disabled?: boolean;
  }> = [
    { label: "Receipt", emoji: "🧾", href: "/receipt", subtitle: "Snap a receipt" },
    clockedJobId
      ? { label: "Estimate current job", emoji: "✏️", href: `/job/${clockedJobId}/estimate/new`, primary: true, subtitle: "You're clocked in" }
      : { label: "Estimate current job", emoji: "✏️", href: "#", disabled: true, subtitle: "Clock into a job first" },
    { label: "Estimate for job", emoji: "📝", href: "/jobs", subtitle: "Pick the job" },
    clockedJobId
      ? { label: "Photos", emoji: "📸", href: `/photos?job=${clockedJobId}`, primary: true, subtitle: "For your current job" }
      : { label: "Photos", emoji: "📸", href: "/photos", subtitle: "Pick the job" },
    { label: "Request parts", emoji: "🔧", href: "/shopping", subtitle: "Add a need" },
  ];

  // My appointments today
  // Filter: tech_primary_name = me OR me in tech_all_names
  // Use OR via two queries union'd (Supabase JS PostgREST doesn't support array
  // contains with OR easily without raw SQL).
  const [todayPrimaryRes, todayHelperRes] = await Promise.all([
    supabase.from("appointments_master")
      .select("appointment_id, hcp_job_id, scheduled_start, customer_name, street, city, status, tech_primary_name")
      .eq("tech_primary_name", techFullName)
      .gte("scheduled_start", todayStart)
      .lte("scheduled_start", todayEnd)
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled")')
      .order("scheduled_start", { ascending: true }),
    supabase.from("appointments_master")
      .select("appointment_id, hcp_job_id, scheduled_start, customer_name, street, city, status, tech_primary_name")
      .contains("tech_all_names", [techFullName])
      .gte("scheduled_start", todayStart)
      .lte("scheduled_start", todayEnd)
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled")')
      .order("scheduled_start", { ascending: true }),
  ]);
  const todayMap = new Map<string, TechAppt>();
  for (const a of (todayPrimaryRes.data ?? []) as TechAppt[]) {
    if (a.appointment_id || a.hcp_job_id) {
      todayMap.set((a.appointment_id ?? a.hcp_job_id)!, a);
    }
  }
  for (const a of (todayHelperRes.data ?? []) as TechAppt[]) {
    const k = (a.appointment_id ?? a.hcp_job_id)!;
    if (!todayMap.has(k)) todayMap.set(k, a);
  }
  const todayAppts = [...todayMap.values()].sort((a, b) =>
    new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
  );

  // My upcoming (next 14 days, excluding today)
  const [upcomingPrimaryRes, upcomingHelperRes] = await Promise.all([
    supabase.from("appointments_master")
      .select("appointment_id, hcp_job_id, scheduled_start, customer_name, street, city, status, tech_primary_name")
      .eq("tech_primary_name", techFullName)
      .gt("scheduled_start", todayEnd)
      .lte("scheduled_start", upcomingEnd)
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled")')
      .order("scheduled_start", { ascending: true })
      .limit(15),
    supabase.from("appointments_master")
      .select("appointment_id, hcp_job_id, scheduled_start, customer_name, street, city, status, tech_primary_name")
      .contains("tech_all_names", [techFullName])
      .gt("scheduled_start", todayEnd)
      .lte("scheduled_start", upcomingEnd)
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled")')
      .order("scheduled_start", { ascending: true })
      .limit(15),
  ]);
  const upcomingMap = new Map<string, TechAppt>();
  for (const a of (upcomingPrimaryRes.data ?? []) as TechAppt[]) {
    if (a.appointment_id || a.hcp_job_id) {
      upcomingMap.set((a.appointment_id ?? a.hcp_job_id)!, a);
    }
  }
  for (const a of (upcomingHelperRes.data ?? []) as TechAppt[]) {
    const k = (a.appointment_id ?? a.hcp_job_id)!;
    if (!upcomingMap.has(k)) upcomingMap.set(k, a);
  }
  const upcomingAppts = [...upcomingMap.values()].sort((a, b) =>
    new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
  ).slice(0, 10);

  // My recent jobs (last 7 days, completed or in-progress)
  // My recent comms (last 14 days, just calls/texts attributed to this tech)
  const recentCommsStart = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [recentPrimaryRes, recentHelperRes, myCommsRes] = await Promise.all([
    supabase.from("job_360")
      .select("hcp_job_id, customer_name, job_date, revenue, appointment_status")
      .eq("tech_primary_name", techFullName)
      .gte("job_date", recentStart)
      .order("job_date", { ascending: false })
      .limit(10),
    supabase.from("job_360")
      .select("hcp_job_id, customer_name, job_date, revenue, appointment_status, tech_all_names")
      .contains("tech_all_names", [techFullName])
      .gte("job_date", recentStart)
      .order("job_date", { ascending: false })
      .limit(10),
    supabase.from("communication_events")
      .select("id, occurred_at, channel, direction, customer_name, hcp_customer_id, importance, summary, flags")
      .eq("tech_short_name", techName)
      .gte("occurred_at", recentCommsStart)
      .order("occurred_at", { ascending: false })
      .limit(15),
  ]);
  const myComms = (myCommsRes.data ?? []) as TechComm[];
  const recentMap = new Map<string, TechJob>();
  for (const j of (recentPrimaryRes.data ?? []) as TechJob[]) recentMap.set(j.hcp_job_id, j);
  for (const j of (recentHelperRes.data ?? []) as TechJob[]) {
    if (!recentMap.has(j.hcp_job_id)) recentMap.set(j.hcp_job_id, j);
  }
  const recentJobs = [...recentMap.values()]
    .sort((a, b) => (b.job_date ?? "").localeCompare(a.job_date ?? ""))
    .slice(0, 10);

  const nowLabel = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <PageShell
      kicker={`Tech · ${techName}`}
      title={`Hey ${techName}`}
      description={`${nowLabel} · your day, your jobs`}
    >
      {clockState && (
        <section className="mb-5">
          <ClockButton initial={clockState} techShortName={techName} />
        </section>
      )}

      {/* Ask bar — primary CTA for "I don't know what to do" / "find me X" */}
      <section className="mb-6">
        <Link
          href="/ask"
          className="flex w-full items-center justify-between rounded-2xl border border-brand-300 bg-gradient-to-r from-brand-50 to-white p-4 shadow-sm transition hover:border-brand-400 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>💬</span>
            <div>
              <div className="font-semibold text-brand-900">Ask TPAR</div>
              <div className="text-xs text-brand-700/80">Type what you want — I&apos;ll direct or advise</div>
            </div>
          </div>
          <span className="text-brand-700">→</span>
        </Link>
      </section>

      {/* Action grid — mode-aware tiles */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => {
            const baseClass = "flex flex-col items-center gap-1.5 rounded-2xl border p-4 text-center shadow-sm transition";
            const enabled = "border-neutral-200 bg-white hover:border-brand-300 hover:bg-brand-50";
            const disabled = "border-neutral-200 bg-neutral-50 cursor-not-allowed opacity-60";
            const primary = "border-brand-400 bg-brand-50 ring-2 ring-brand-300";
            const cls = t.disabled ? `${baseClass} ${disabled}` : t.primary ? `${baseClass} ${primary}` : `${baseClass} ${enabled}`;
            const inner = (
              <>
                <span className="text-2xl" aria-hidden>{t.emoji}</span>
                <span className={`text-sm font-semibold ${t.primary ? "text-brand-900" : "text-neutral-900"}`}>{t.label}</span>
                {t.subtitle ? (
                  <span className={`text-[10px] uppercase tracking-wide ${t.primary ? "text-brand-700" : t.disabled ? "text-neutral-400" : "text-neutral-500"}`}>
                    {t.subtitle}
                  </span>
                ) : null}
              </>
            );
            if (t.disabled) return <div key={t.label} className={cls}>{inner}</div>;
            return <Link key={t.label} href={t.href} className={cls}>{inner}</Link>;
          })}
        </div>
      </section>

      <div className="space-y-8">
        <Section
          title="Today"
          description={
            todayAppts.length === 0
              ? "Nothing on the books today."
              : `${todayAppts.length} appointment${todayAppts.length === 1 ? "" : "s"}`
          }
        >
          {todayAppts.length === 0 ? (
            <EmptyState title="Quiet day." description="Use the time to clean up estimates or follow-ups." />
          ) : (
            <ul className="space-y-2">
              {todayAppts.map((a) => {
                const isHelper = a.tech_primary_name && a.tech_primary_name !== techName;
                return (
                  <li key={(a.appointment_id ?? a.hcp_job_id)!} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono tabular-nums text-base font-semibold text-brand-700">
                        {fmtTime(a.scheduled_start)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-neutral-900">
                          {a.hcp_job_id ? (
                            <Link href={`/job/${a.hcp_job_id}`} className="hover:underline">{a.customer_name ?? "—"}</Link>
                          ) : (
                            a.customer_name ?? "—"
                          )}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {[a.street, a.city].filter(Boolean).join(", ") || "no address"}
                          {isHelper ? <> · helping <span className="font-medium">{a.tech_primary_name}</span></> : null}
                        </div>
                      </div>
                      {a.status ? <Pill tone="slate">{a.status}</Pill> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="Upcoming (14 days)"
          description={
            upcomingAppts.length === 0
              ? "No upcoming appointments scheduled for you."
              : `${upcomingAppts.length} on the calendar`
          }
        >
          {upcomingAppts.length === 0 ? (
            <EmptyState title="Open calendar — heads up to scheduling." />
          ) : (
            <ul className="space-y-2">
              {upcomingAppts.map((a) => {
                const isHelper = a.tech_primary_name && a.tech_primary_name !== techName;
                return (
                  <li key={(a.appointment_id ?? a.hcp_job_id)!} className="rounded-2xl border border-neutral-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-neutral-500">{fmtDate(a.scheduled_start)}</span>
                      <span className="font-mono text-xs text-neutral-500">{fmtTime(a.scheduled_start)}</span>
                      {a.hcp_job_id ? (
                        <Link href={`/job/${a.hcp_job_id}`} className="font-medium hover:underline">
                          {a.customer_name ?? "—"}
                        </Link>
                      ) : (
                        <span className="font-medium">{a.customer_name ?? "—"}</span>
                      )}
                      {isHelper ? (
                        <span className="text-xs text-neutral-500">· helping {a.tech_primary_name}</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="Recent (last 7 days)"
          description={
            recentJobs.length === 0
              ? "Nothing recent."
              : `${recentJobs.length} job${recentJobs.length === 1 ? "" : "s"}`
          }
        >
          {recentJobs.length === 0 ? (
            <EmptyState title="Quiet week so far." />
          ) : (
            <ul className="space-y-2">
              {recentJobs.map((j) => (
                <li key={j.hcp_job_id} className="rounded-2xl border border-neutral-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-neutral-500">{fmtDate(j.job_date)}</span>
                    <Link href={`/job/${j.hcp_job_id}`} className="font-medium hover:underline">
                      {j.customer_name ?? "(no name)"}
                    </Link>
                    <span className="ml-auto text-xs text-neutral-600 tabular-nums">{fmtMoney(j.revenue)}</span>
                    {j.appointment_status ? <Pill tone="slate">{j.appointment_status}</Pill> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Your recent comms (14 days)"
          description={
            myComms.length === 0
              ? "Nothing recent."
              : <>{myComms.length} {myComms.length === 1 ? "event" : "events"} attributed to you · <Link href="/comms?mine=1" className="text-brand-700 hover:underline">all yours →</Link></>
          }
        >
          {myComms.length === 0 ? (
            <EmptyState title="No calls or texts attributed to you yet." />
          ) : (
            <ul className="space-y-2">
              {myComms.slice(0, 8).map((c) => {
                const flagged = Array.isArray(c.flags) && c.flags.some((f) =>
                  ["needs_followup", "unresolved", "escalation_needed"].includes(f)
                );
                return (
                  <li key={c.id} className="rounded-2xl border border-neutral-200 bg-white p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <Pill tone="slate">{c.channel}</Pill>
                      {c.direction ? <Pill tone="slate">{c.direction}</Pill> : null}
                      {flagged ? <Pill tone="amber">follow-up</Pill> : null}
                      <span>imp {c.importance ?? "—"}</span>
                      <span className="ml-auto font-mono">{fmtDate(c.occurred_at)}</span>
                    </div>
                    <div className="text-sm">
                      {c.hcp_customer_id ? (
                        <Link href={`/customer/${c.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                          {c.customer_name ?? "(no name)"}
                        </Link>
                      ) : (
                        <span className="font-medium text-neutral-900">{c.customer_name ?? "(no name)"}</span>
                      )}
                    </div>
                    {c.summary ? <p className="mt-1 text-xs text-neutral-600">{c.summary}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </PageShell>
  );
}
