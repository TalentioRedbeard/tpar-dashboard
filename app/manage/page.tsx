// /manage — the management ACTION RAIL (build plan 2026-07-13, section 2.2).
// Not a dashboard: every tile is a door into the queue that fixes it, stamped
// with its as-of time; below sits the exception rail (a single aged list).
// Owners: Madisson + Kelsey (manager tier) + Danny. Anti-stall doctrine:
// queues display their own rot (count AND oldest age), zero-state is
// celebrated, and passive metrics without an adjacent action live on /owner
// and /reports — not here.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { getCurrentTech } from "../../lib/current-tech";
import { ScheduleRequests } from "./ScheduleRequests";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage · TPAR-DB" };

const CHI = "America/Chicago";

function chiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: CHI });
}
function chiWeekStartIso(): string {
  // Sunday-start week, matching HCP timecards and the timecard sync.
  const now = new Date();
  const dow = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: CHI, weekday: "short" }).format(now) === "Sun"
      ? 0
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
          new Intl.DateTimeFormat("en-US", { timeZone: CHI, weekday: "short" }).format(now),
        ),
  );
  const d = new Date(`${chiToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function asOf(): string {
  return new Date().toLocaleTimeString("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit" });
}
function fmtK(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

type Exception = {
  kind: string;
  label: string;
  detail: string;
  ageDays: number;
  href: string;
};

export default async function ManagePage() {
  const me = await getCurrentTech();
  const supa = db();
  const today = chiToday();
  const weekStart = chiWeekStartIso();

  const [apptRes, clockedRes, invRes, estRes, conflictRes, sendFailRes, flagRes, captureRes, ownerCtxRes, custCtxRes, dailyRevRes, staleRegRes, schedReqRes] = await Promise.all([
    // Tile 1: today's board — jobs today vs techs clocked in.
    supa
      .from("appointments_master")
      .select("appointment_id", { count: "exact", head: true })
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled")')
      .gte("scheduled_start", `${today}T00:00:00-05:00`)
      .lt("scheduled_start", `${today}T23:59:59-05:00`),
    supa.from("tech_currently_clocked_in_v").select("tech_short_name, clocked_in_at"),
    // Tile 2: money this week — invoiced vs collected (CENTS, summed code-side).
    supa
      .from("hcp_invoices_by_job")
      .select("amount, status")
      .gte("invoice_date", weekStart)
      .limit(1000),
    // Tile 3: estimates aging — awaiting >3 days, split unsent vs unanswered.
    supa
      .from("estimate_pipeline_v")
      .select("hcp_estimate_id, age_days, last_sent_at")
      .eq("stage", "awaiting")
      .gt("age_days", 3)
      .order("age_days", { ascending: false })
      .limit(1000),
    // Tile 4 + rail: timecard conflicts (the sync fn is the watcher; this
    // panel is the reviewer — we only READ timecard_sync_days).
    supa
      .from("timecard_sync_days")
      .select("tech_short_name, work_date, conflicts")
      .eq("status", "conflict")
      .order("work_date", { ascending: true }),
    // Rail: customer-facing sends that failed.
    supa
      .from("estimate_sends")
      .select("hcp_estimate_id, to_email, status, sent_at")
      .in("status", ["bounced", "failed", "complained"])
      .order("sent_at", { ascending: false })
      .limit(50),
    // Rail: open flags — the team's noticings, adjudicated on /manage/flags.
    supa
      .from("data_flags")
      .select("id, entity_label, entity_id, flag_type, created_by, created_at, status")
      .in("status", ["open", "in_review"])
      .order("created_at", { ascending: true })
      .limit(200),
    // Office capture state (plan section 11.7) — the watchdog DMs on death;
    // this is the always-visible mirror of the same condition view.
    supa.from("office_capture_health_v").select("state, minutes_since_last").maybeSingle(),
    // Review backlogs (plan section 11.4): counts + oldest age ONLY. The
    // owner_context CONTENT stays behind isOwner — never rendered here.
    supa.from("owner_context").select("created_at", { count: "exact" }).eq("status", "pending_review").order("created_at", { ascending: true }).limit(1),
    supa.from("customer_context").select("created_at", { count: "exact" }).eq("status", "pending_review").order("created_at", { ascending: true }).limit(1),
    supa.from("daily_reviews").select("created_at", { count: "exact" }).order("created_at", { ascending: true }).limit(1),
    // Product registrations rotting past 14 days (SPEC_2026-07-16).
    supa.from("product_registrations").select("id, brand, model, created_at").eq("status", "pending")
      .lt("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true }).limit(20),
    // B2: wrap-sourced schedule requests awaiting ack/decline (auto-created by
    // tech-wrap-distill, assigned to the scheduler — this is their only surface).
    supa.from("tasks").select("id, title, detail, assigned_to, created_at")
      .eq("ref_kind", "wrap_schedule_request")
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const jobsToday = apptRes.count ?? 0;
  const clocked = clockedRes.data ?? [];
  const invRows = (invRes.data ?? []) as Array<{ amount: number | null; status: string | null }>;
  const invoicedCents = invRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const collectedCents = invRows
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const estRows = (estRes.data ?? []) as Array<{ age_days: number | null; last_sent_at: string | null }>;
  const estUnsent = estRows.filter((r) => !r.last_sent_at).length;
  const estOldest = estRows.length ? Math.max(...estRows.map((r) => r.age_days ?? 0)) : 0;
  const conflicts = (conflictRes.data ?? []) as Array<{ tech_short_name: string; work_date: string; conflicts: unknown }>;
  const sendFails = (sendFailRes.data ?? []) as Array<{ hcp_estimate_id: string; to_email: string | null; status: string; sent_at: string | null }>;
  const openFlags = (flagRes.data ?? []) as Array<{ id: number; entity_label: string | null; entity_id: string; flag_type: string; created_by: string; created_at: string; status: string }>;
  const capture = captureRes.data as { state: string; minutes_since_last: number | null } | null;
  const staleRegs = (staleRegRes.data ?? []) as Array<{ id: number; brand: string | null; model: string | null; created_at: string }>;
  const schedReqs = ((schedReqRes.data ?? []) as Array<{ id: string; title: string; detail: string | null; assigned_to: string | null; created_at: string }>)
    .map((t) => ({
      id: t.id,
      title: t.title,
      detail: t.detail,
      assignedTo: t.assigned_to,
      createdAt: t.created_at,
      ageDays: Math.max(0, Math.floor((Date.now() - new Date(t.created_at).getTime()) / (24 * 60 * 60 * 1000))),
    }));
  const ageOf = (iso: string | undefined | null) =>
    iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))) : null;
  const backlogs = [
    { label: "Customer context proposals", count: custCtxRes.count ?? 0, oldest: ageOf((custCtxRes.data?.[0] as { created_at?: string } | undefined)?.created_at), href: "/context" as string | null },
    { label: "Owner context (owner-only)", count: ownerCtxRes.count ?? 0, oldest: ageOf((ownerCtxRes.data?.[0] as { created_at?: string } | undefined)?.created_at), href: null },
    { label: "Daily reviews", count: dailyRevRes.count ?? 0, oldest: ageOf((dailyRevRes.data?.[0] as { created_at?: string } | undefined)?.created_at), href: null },
  ];

  const dayMs = 24 * 60 * 60 * 1000;
  const exceptions: Exception[] = [
    ...conflicts.map((c) => ({
      kind: "Timecard conflict",
      label: `${c.tech_short_name} · ${c.work_date}`,
      detail: "App entry disagrees with HCP — bring to Danny with the side-by-side.",
      ageDays: Math.max(0, Math.floor((Date.now() - new Date(`${c.work_date}T12:00:00Z`).getTime()) / dayMs)),
      href: `/manage/timecards?week=${c.work_date}`,
    })),
    ...sendFails.map((s) => ({
      kind: `Send ${s.status}`,
      label: s.to_email ?? s.hcp_estimate_id,
      detail: "A customer-facing email did not arrive — re-check the address and resend.",
      ageDays: s.sent_at ? Math.max(0, Math.floor((Date.now() - new Date(s.sent_at).getTime()) / dayMs)) : 0,
      href: "/estimates",
    })),
    ...openFlags.map((f) => ({
      kind: f.status === "in_review" ? "Flag · with Danny" : "Flag",
      label: `${f.flag_type} · ${f.entity_label ?? f.entity_id}`,
      detail: `Raised by ${f.created_by.split("@")[0]} — adjudicate on the flags queue.`,
      ageDays: Math.max(0, Math.floor((Date.now() - new Date(f.created_at).getTime()) / dayMs)),
      href: "/manage/flags",
    })),
    // Office recorder down = an exception someone can fix in 10 seconds.
    ...(capture && (capture.state === "stopped" || capture.state === "no_data")
      ? [{
          kind: "Recorder down",
          label: `Office capture ${capture.state === "no_data" ? "has no data" : `stopped ${capture.minutes_since_last ?? "?"} min ago`}`,
          detail: "The recorder tab likely died — reopen it on the office machine. (Watchdog DMs Danny too.)",
          ageDays: 0,
          href: "#",
        }]
      : []),
    // Product registrations rotting past 14 days (SPEC_2026-07-16 anti-rot:
    // the existing rail, no new watcher).
    ...staleRegs.map((r) => ({
      kind: "Registration pending",
      label: `${r.brand ?? "unknown brand"} ${r.model ?? ""}`.trim(),
      detail: "Logged on a job but never registered with the manufacturer — work the Shopping-page batch.",
      ageDays: Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / dayMs)),
      href: "/shopping",
    })),
  ].sort((a, b) => b.ageDays - a.ageDays);

  const stamp = asOf();

  const tiles = [
    {
      icon: "🗓️",
      label: "Today's board",
      value: `${jobsToday} jobs · ${clocked.length} clocked in`,
      sub: clocked.length
        ? clocked.map((c) => c.tech_short_name).join(", ")
        : "Nobody on the clock right now",
      href: "/dispatch/today",
      cta: "Open the board",
    },
    {
      icon: "💵",
      label: "Money this week",
      value: `${fmtK(invoicedCents)} invoiced`,
      sub: `${fmtK(collectedCents)} collected · week of ${weekStart}`,
      href: "/reports",
      cta: "Open reports",
    },
    {
      icon: "📄",
      label: "Estimates aging",
      value: `${estRows.length} awaiting >3 days`,
      sub: estRows.length
        ? `${estUnsent} never emailed · oldest ${estOldest}d`
        : "Nothing aging — clean pipeline",
      href: "/estimates",
      cta: "Work the pipeline",
    },
    {
      icon: "🚨",
      label: "Exceptions open",
      value: `${exceptions.length}`,
      sub: exceptions.length
        ? `${openFlags.length ? `${openFlags.length} flags · ` : ""}oldest ${exceptions[0].ageDays}d — work the rail below`
        : "Zero. Clear board — that's the goal state.",
      href: openFlags.length ? "/manage/flags" : "#exceptions",
      cta: openFlags.length ? "Open the flags queue" : "Jump to the rail",
    },
  ];

  return (
    <PageShell
      icon="🧰"
      title="Manage"
      description={`Queues with owners, ages, and verbs — every tile is a door into the queue that fixes it. Signed in as ${me?.email ?? "?"} (${me?.isAdmin ? "admin" : "manager"}).`}
    >
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="group rounded-2xl border-2 border-brand-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/30 hover:shadow"
          >
            <div className="flex items-start gap-3">
              <span aria-hidden className="text-3xl leading-none">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-500">
                  {t.label}
                </div>
                <div className="mt-0.5 truncate text-sm font-bold text-brand-900">{t.value}</div>
                <div className="mt-0.5 truncate text-xs text-neutral-600">{t.sub}</div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-400">
                  <span className="font-medium text-brand-700 group-hover:underline">{t.cta} →</span>
                  <span>as of {stamp}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </section>

      {/* B2: schedule requests sit ABOVE the exception rail — they're asks
          with a person waiting, not anomalies. */}
      <ScheduleRequests rows={schedReqs} />

      <section id="exceptions" className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-600">
          Exception rail
        </h2>
        {exceptions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            🎉 Nothing needs a human. Zero exceptions is the goal state, not a fluke — enjoy it.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border-2 border-neutral-300 bg-white shadow-sm">
            <ul className="divide-y divide-neutral-100">
              {exceptions.map((e, i) => (
                <li key={i}>
                  <Link href={e.href} className="flex items-center gap-3 px-4 py-3 transition hover:bg-brand-50/40">
                    <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
                      {e.kind}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-900">{e.label}</span>
                      <span className="block truncate text-xs text-neutral-500">{e.detail}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${e.ageDays >= 7 ? "text-red-600" : e.ageDays >= 3 ? "text-amber-600" : "text-neutral-500"}`}>
                      {e.ageDays === 0 ? "today" : `${e.ageDays}d`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Review backlogs (plan section 11.4): the 70b's output waiting for
          eyes — counts + oldest age only; owner-context CONTENT never renders
          here. Capture state chip = the watchdog's always-visible mirror. */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-600">Review backlogs</h2>
        <div className="flex flex-wrap items-center gap-2">
          {backlogs.map((b) => {
            const chip = (
              <span className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm ${b.count > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-neutral-200 bg-white text-neutral-500"}`}>
                <span className="font-bold">{b.count}</span>
                <span>{b.label}</span>
                {b.oldest != null && b.count > 0 ? <span className="text-xs opacity-70">· oldest {b.oldest}d</span> : null}
              </span>
            );
            return b.href && b.count > 0 ? (
              <Link key={b.label} href={b.href} className="transition hover:opacity-80">{chip}</Link>
            ) : (
              <span key={b.label}>{chip}</span>
            );
          })}
          {capture ? (
            <span className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm ${
              capture.state === "capturing" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : capture.state === "silent" ? "border-neutral-200 bg-white text-neutral-600"
              : "border-red-200 bg-red-50 text-red-800"
            }`}>
              🎙️ Office capture: <span className="font-semibold">{capture.state}</span>
            </span>
          ) : null}
        </div>
      </section>

      <section className="text-xs text-neutral-500">
        <Link href="/manage/flags" className="hover:underline">
          🚩 Flags queue →
        </Link>
        <span className="mx-2">·</span>
        <Link href="/manage/timecards" className="hover:underline">
          🕐 Timecard review →
        </Link>
        <span className="mx-2">·</span>
        <Link href="/manage/sends" className="hover:underline">
          📨 Sends ledger →
        </Link>
        <span className="mx-2">·</span>
        <Link href="/admin/data-health" className="hover:underline">
          System data health (engineer view) →
        </Link>
        <span className="mx-2">·</span>
        Coming to this panel: campaign batch review.
      </section>
    </PageShell>
  );
}
