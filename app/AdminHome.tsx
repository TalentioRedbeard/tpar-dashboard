// AdminHome — intent-first home for admin / manager / production_manager.
//
// Per Danny 2026-05-04: "We want the first page to be something that directs
// you straight towards what you want to do, and if you don't know how, tell
// it what you want and it'll direct you/advise you (based on your role's
// scope)."
//
// Layout (mobile-first):
//   1. Clock card (preserved — anchor of the day)
//   2. Big "Ask TPAR" button → /ask (intent router)
//   3. 6-tile mode-aware action grid (Receipt · Estimate-current · Estimate-for-job · Photos · Parts · Snap)
//   4. Compact "today" strip — one-line summary, tap to /dispatch for detail
//   5. Expandable "Operations details" — the legacy data dashboard (follow-ups, AR, recent jobs, customers)

import Link from "next/link";
import { db } from "@/lib/supabase";
import type { CurrentTech } from "@/lib/current-tech";
import { getCurrentState as getClockState, type CurrentClockState } from "./time/actions";
import { ClockButton } from "../components/ClockButton";
import { PageShell } from "../components/PageShell";
import { Section } from "../components/ui/Section";
import { Pill } from "../components/ui/Pill";

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

interface TodayAppt {
  appointment_id: string | null;
  hcp_job_id: string | null;
  scheduled_start: string;
  customer_name: string | null;
}

export default async function AdminHome({ me }: { me: CurrentTech }) {
  const supabase = db();

  // Date window for today's-summary (Chicago tz)
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const todayStart = new Date(`${todayKey}T00:00:00-05:00`).toISOString();
  const todayEnd   = new Date(`${todayKey}T23:59:59-05:00`).toISOString();

  // Parallel: clock state + today's count + brief AR + brief follow-up count
  const [clockState, todayApptsRes, openARRes, followupCountRes] = await Promise.all([
    me.tech ? getClockState().catch(() => null) : Promise.resolve(null),
    supabase
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, scheduled_start, customer_name", { count: "exact", head: false })
      .gte("scheduled_start", todayStart)
      .lte("scheduled_start", todayEnd)
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled")')
      .not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")')
      .order("scheduled_start", { ascending: true })
      .limit(5),
    supabase
      .from("job_360")
      .select("due_amount", { count: "exact", head: true })
      .gt("due_amount", 0),
    supabase
      .from("communication_events")
      .select("id", { count: "exact", head: true })
      .gte("occurred_at", new Date(Date.now() - 14 * 86400_000).toISOString())
      .or("flags.cs.{needs_followup},flags.cs.{unresolved},flags.cs.{escalation_needed}")
      .gte("importance", 5)
      .is("acked_at", null),
  ]);

  const todayAppts = (todayApptsRes.data ?? []) as TodayAppt[];
  const todayCount = todayAppts.length;
  const firstAppt = todayAppts[0]?.scheduled_start ? fmtTime(todayAppts[0].scheduled_start) : null;
  const openARCount = openARRes.count ?? 0;
  const followupCount = followupCountRes.count ?? 0;

  // Mode-awareness: is the user clocked into a specific job right now?
  const clockedIntoJob =
    clockState && clockState.state === "clocked-in"
      ? (clockState as Extract<CurrentClockState, { state: "clocked-in" }>).hcp_job_id
      : null;

  // Action tiles (mode-aware)
  const tiles: Array<{
    label: string; emoji: string; href: string; primary?: boolean; subtitle?: string; disabled?: boolean;
  }> = [
    { label: "Receipt", emoji: "🧾", href: "/receipt", subtitle: "Log a receipt photo" },
    clockedIntoJob
      ? { label: "Estimate current job", emoji: "✏️", href: `/job/${clockedIntoJob}/estimate/new`, primary: true, subtitle: "You're clocked in" }
      : { label: "Estimate current job", emoji: "✏️", href: "#", disabled: true, subtitle: "Clock into a job first" },
    { label: "Estimate for job", emoji: "📝", href: "/jobs", subtitle: "Pick the job" },
    { label: "Photos / videos", emoji: "📸", href: "/photos", subtitle: "For a job" },
    { label: "Request parts", emoji: "🔧", href: "/shopping", subtitle: "Add a need" },
    { label: "Membership", emoji: "🎟️", href: "/customers", subtitle: "Enroll a customer" },
    { label: "Snap", emoji: "💻", href: "/snap", subtitle: "Screenshot bridge" },
    { label: "SalesAsk", emoji: "🎙️", href: "https://app.salesask.com", subtitle: "Open the recording app" },
  ];

  const nowLabel = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <PageShell
      kicker={`${me.dashboardRole === "admin" ? "Owner" : me.dashboardRole === "manager" ? "Manager" : me.dashboardRole === "production_manager" ? "Production" : "Today"} · ${nowLabel}`}
      title="What do you want to do?"
      description={
        <span className="text-neutral-500">
          Tap an action below, or ask TPAR.
        </span>
      }
    >
      {/* Clock card */}
      {clockState && me.tech ? (
        <section className="mb-5">
          <ClockButton initial={clockState} techShortName={me.tech.tech_short_name} />
        </section>
      ) : null}

      {/* Ask bar */}
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

      {/* Action grid — 2 columns on phone, 3 on tablet, 6 on desktop */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            if (t.disabled) {
              return <div key={t.label} className={cls}>{inner}</div>;
            }
            return (
              <Link key={t.label} href={t.href} className={cls}>
                {inner}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Compact today strip */}
      <section className="mb-6">
        <Link
          href="/dispatch"
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-white p-3 text-sm shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-neutral-900">Today</span>
            <span className="text-neutral-700">
              <span className="font-mono tabular-nums">{todayCount}</span> appt{todayCount === 1 ? "" : "s"}
            </span>
            {firstAppt ? <span className="text-neutral-500">first {firstAppt}</span> : null}
            {followupCount > 0 ? (
              <Pill tone="amber">{followupCount} follow-ups open</Pill>
            ) : null}
            {openARCount > 0 ? (
              <Pill tone="red">{openARCount} jobs with AR</Pill>
            ) : null}
          </div>
          <span className="text-xs text-neutral-500">→ dispatch</span>
        </Link>
      </section>

      {/* Operations details — collapsed by default */}
      <details className="rounded-2xl border border-neutral-200 bg-white">
        <summary className="cursor-pointer list-none p-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between">
            <span>Operations details</span>
            <span className="text-xs text-neutral-500">tap to expand</span>
          </span>
        </summary>
        <div className="border-t border-neutral-200 p-4">
          <p className="mb-3 text-xs text-neutral-500">
            The legacy data view (follow-ups, customers by activity, recent jobs, AR detail) lives at the dedicated routes:
          </p>
          <ul className="space-y-1 text-sm">
            <li><Link href="/comms" className="text-brand-700 hover:underline">→ /comms</Link> — open follow-ups + recent calls/texts (mark-handled lives here)</li>
            <li><Link href="/customers" className="text-brand-700 hover:underline">→ /customers</Link> — leaders by open follow-ups, lifetime metrics</li>
            <li><Link href="/jobs" className="text-brand-700 hover:underline">→ /jobs</Link> — recent + all-time job history</li>
            <li><Link href="/reports/ar" className="text-brand-700 hover:underline">→ /reports/ar</Link> — full AR detail</li>
            <li><Link href="/reports/patterns" className="text-brand-700 hover:underline">→ /reports/patterns</Link> — preventative candidates</li>
          </ul>
        </div>
      </details>

      {/* Footer */}
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        <span>TPAR-DB · {me.email}</span>
        {me.isAdmin ? (
          <Link href="/admin/view-as" className="text-neutral-600 hover:text-neutral-900 hover:underline">
            view as tech →
          </Link>
        ) : null}
      </footer>
    </PageShell>
  );
}
