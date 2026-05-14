// Dispatch v0 — TODAY-first view designed for Madisson + Danny.
//
// Top strip:   open intake | last-24h scheduled | today committed $$ | today recognized $$
// Lanes:       one column per active tech, today's appts as cards
//              (each card shows time / customer / address / status / $ / GPS-arrival hint)
// Stale + Week-ahead: preserved from v0-pre as collapsible sections.
//
// Gate: admin + manager only. Per Danny 2026-05-13 — dispatch is the
// Madisson unlock; tech-tier shouldn't see the bottom-of-screen revenue
// + dollar-conversion math (per 2026-05-04 information-access tiers).

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { fmtMoney } from "../../components/Table";
import { TechName } from "../../components/ui/TechName";
import { getFormerTechNames } from "../../lib/former-techs";
import { getCurrentTech } from "../../lib/current-tech";
import { DispatchMap, type CustomerPin, type VanPin } from "../../components/DispatchMap";

export const metadata = { title: "Dispatch · TPAR-DB" };
export const dynamic = "force-dynamic";

type Appt = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: string | null;
  appointment_type: string | null;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
  customer_name: string | null;
  street: string | null;
  city: string | null;
  total_amount: number | null;
  flags: string[] | null;
};

type GpsArrival = {
  appointment_id: string;
  arrival_utc: string | null;
  on_time: boolean | null;
  time_on_site_minutes: number | null;
  gps_matched: boolean;
};

type LifecycleEvent = {
  hcp_job_id: string | null;
  trigger_number: number;
  fired_at: string;
};

const CHI = "America/Chicago";

function chicagoDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: CHI });
}
function chicagoDateLabel(key: string): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: CHI });
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: CHI });
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  const d = new Date(key + "T12:00:00");
  return d.toLocaleDateString("en-US", { timeZone: CHI, weekday: "long", month: "short", day: "numeric" });
}
function chicagoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit" });
}
function statusTone(status: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "complete":
    case "complete rated":
    case "complete unrated":
      return "bg-emerald-100 text-emerald-800";
    case "in progress":
    case "en route":
      return "bg-blue-100 text-blue-800";
    case "scheduled":
      return "bg-neutral-100 text-neutral-700";
    case "canceled":
    case "cancelled":
      return "bg-red-100 text-red-800";
    case "needs scheduling":
    case "user canceled":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

// Tech state derived from lifecycle events fired today.
// trigger_number map (per JOB_LIFECYCLE_TRIGGERS.md):
//   2 = on_my_way, 3 = start, 6 = finish
function techStateFromEvents(events: LifecycleEvent[]): "💤" | "🚚" | "🔧" | "✓" {
  if (events.some((e) => e.trigger_number === 6)) return "✓";
  if (events.some((e) => e.trigger_number === 3)) return "🔧";
  if (events.some((e) => e.trigger_number === 2)) return "🚚";
  return "💤";
}
function techStateLabel(state: string): string {
  return state === "💤" ? "Not started"
       : state === "🚚" ? "En route"
       : state === "🔧" ? "On site"
       : state === "✓"  ? "Finished" : "—";
}

export default async function DispatchPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const supa = db();

  const nowCtKey = new Date().toLocaleDateString("en-CA", { timeZone: CHI });
  const todayStartUtc = new Date(`${nowCtKey}T00:00:00-05:00`).toISOString();
  const todayEndUtc = new Date(new Date(`${nowCtKey}T00:00:00-05:00`).getTime() + 86_400_000).toISOString();
  const weekEndUtc = new Date(new Date(`${nowCtKey}T00:00:00-05:00`).getTime() + 7 * 86_400_000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const last24hAgo = new Date(Date.now() - 86_400_000).toISOString();

  const customerExcludeSql = '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")';
  const testCustomerSql = '("cus_9cf8cc5b02e1430a85288b034763cc19","cus_386a644b8054483788825c86c1b13b9c")';
  const cancelStatusSql = '("pro canceled","user canceled","cancelled","canceled","Pro Canceled","User Canceled","Cancelled","Canceled")';

  const [
    todayRes,
    weekRes,
    staleRes,
    last24hRes,
    intakeRes,
    paidTodayRes,
    activeTechsRes,
    gpsRes,
    lifecycleRes,
    vansRes,
    mapCustomersRes,
    vanPositionsRes,
    openArRes,
    agedHighImpRes,
    agedHighImpCountRes,
  ] = await Promise.all([
    // Today's appts (Chicago day, no cancels, no internal customers, no test customers)
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, scheduled_end, status, appointment_type, tech_primary_name, tech_all_names, customer_name, street, city, total_amount, flags")
      .gte("scheduled_start", todayStartUtc)
      .lt("scheduled_start", todayEndUtc)
      .not("status", "in", cancelStatusSql)
      .not("customer_name", "in", customerExcludeSql)
      .not("hcp_customer_id", "in", testCustomerSql)
      .order("scheduled_start", { ascending: true }),
    // Week ahead (tomorrow → +7d) — preserved from v0-pre
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, scheduled_end, status, appointment_type, tech_primary_name, tech_all_names, customer_name, street, city, total_amount, flags")
      .gte("scheduled_start", todayEndUtc)
      .lt("scheduled_start", weekEndUtc)
      .not("status", "in", cancelStatusSql)
      .not("customer_name", "in", customerExcludeSql)
      .not("hcp_customer_id", "in", testCustomerSql)
      .order("scheduled_start", { ascending: true }),
    // Stale appointments (operational debt)
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, status, tech_primary_name, customer_name, street, city")
      .lt("scheduled_start", sevenDaysAgo)
      .in("status", ["scheduled", "Scheduled", "needs scheduling", "Needs Scheduling"])
      .not("hcp_customer_id", "in", testCustomerSql)
      .order("scheduled_start", { ascending: false })
      .limit(40),
    // Scheduling activity in the last 24h — proxy for Madisson's work
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, total_amount", { count: "exact", head: false })
      .gte("created_at", last24hAgo)
      .not("status", "in", cancelStatusSql)
      .not("hcp_customer_id", "in", testCustomerSql),
    // Open intake (communication_events with follow-up flags) — proxy for queue
    supa
      .from("communication_events")
      .select("id", { count: "exact", head: true })
      .is("acked_at", null)
      .gte("importance", 5)
      .overlaps("flags", ["needs_followup", "unresolved", "escalation_needed"])
      .gte("occurred_at", new Date(Date.now() - 14 * 86_400_000).toISOString()),
    // Today's paid invoices (recognized revenue tied to today's jobs)
    supa
      .from("hcp_invoices_by_job")
      .select("hcp_job_id, amount, status, invoice_date")
      .eq("status", "paid")
      .gte("invoice_date", nowCtKey),
    // Active techs (everyone on duty today, even those without an appt) — for empty-lane rendering
    supa
      .from("tech_directory")
      .select("tech_short_name, hcp_full_name, dashboard_role, is_lead, is_active")
      .eq("is_active", true)
      .neq("is_test", true)
      .in("dashboard_role", ["tech", "admin"])
      .order("is_lead", { ascending: false })
      .order("tech_short_name"),
    // GPS arrival hints for today's appts
    supa
      .from("tech_appointment_trips_v")
      .select("appointment_id, arrival_utc, on_time, time_on_site_minutes, gps_matched")
      .gte("scheduled_start", todayStartUtc)
      .lt("scheduled_start", todayEndUtc),
    // Lifecycle events fired today (gives us tech state per job)
    supa
      .from("job_lifecycle_events")
      .select("hcp_job_id, trigger_number, fired_at")
      .gte("fired_at", todayStartUtc),
    // Vans (driver assignments, for the lane header pill)
    supa
      .from("vehicles_master")
      .select("display_name, primary_driver_short_name, kind, vin")
      .eq("is_active", true)
      .not("primary_driver_short_name", "is", null),
    // Map: today's appts with geocoded customer lat/lng
    supa
      .from("appointment_location_v")
      .select("appointment_id, hcp_job_id, customer_name, street, city, scheduled_start, status, tech_primary_name, cust_lat, cust_lng")
      .gte("scheduled_start", todayStartUtc)
      .lt("scheduled_start", todayEndUtc)
      .not("cust_lat", "is", null)
      .not("cust_lng", "is", null),
    // Map: latest GPS pin per driver-assigned active vehicle (24h window).
    // View handles the bouncie→vehicles_master join via VIN, see migration
    // 20260513230000_vehicle_last_known_position_v.
    supa
      .from("vehicle_last_known_position_v")
      .select("vehicle_id, display_name, driver_short_name, driver_full_name, lat, lng, last_seen_at"),
    // Open AR — invoices in 'open' or 'pending_payment' state on jobs HCP
    // marks completed. Surfaced 2026-05-14 after variance audit found $38k+
    // sitting in this bucket. Madisson's collection lever lives here.
    supa
      .from("hcp_invoices_by_job")
      .select("hcp_invoice_id, hcp_job_id, amount, due_amount, status, invoice_date")
      .in("status", ["open", "pending_payment"])
      .gte("invoice_date", new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0,10))
      .limit(500),
    // High-importance aged comms — variance audit V13 surfaced 62 imp≥7
    // events unacked >24h. Top 6 here, link to full queue for the rest.
    supa
      .from("communication_events")
      .select("id, occurred_at, channel, direction, customer_name, importance, summary, flags, tech_short_name")
      .is("acked_at", null)
      .gte("importance", 7)
      .lt("occurred_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .gte("occurred_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .or("direction.is.null,direction.neq.internal")
      .order("importance", { ascending: false })
      .order("occurred_at", { ascending: false })
      .limit(6),
    // Total count for the aged-high-imp banner (so the badge reflects reality, not just top 6)
    supa
      .from("communication_events")
      .select("id", { count: "exact", head: true })
      .is("acked_at", null)
      .gte("importance", 7)
      .lt("occurred_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .gte("occurred_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .or("direction.is.null,direction.neq.internal"),
  ]);

  const todayRows = (todayRes.data ?? []) as Appt[];
  const weekRows = (weekRes.data ?? []) as Appt[];
  const staleRows = (staleRes.data ?? []) as Array<{
    appointment_id: string | null; hcp_job_id: string | null; hcp_customer_id: string | null;
    scheduled_start: string; status: string | null; tech_primary_name: string | null;
    customer_name: string | null; street: string | null; city: string | null;
  }>;
  const last24hRows = (last24hRes.data ?? []) as Array<{ total_amount: number | null }>;
  const intakeCount = intakeRes.count ?? 0;
  const paidToday = (paidTodayRes.data ?? []) as Array<{ hcp_job_id: string; amount: number }>;
  const activeTechs = (activeTechsRes.data ?? []) as Array<{ tech_short_name: string; hcp_full_name: string; is_lead: boolean | null }>;
  const gpsByAppt = new Map<string, GpsArrival>(
    ((gpsRes.data ?? []) as GpsArrival[]).map((g) => [g.appointment_id, g]),
  );
  const lifecycleByJob = new Map<string, LifecycleEvent[]>();
  for (const e of (lifecycleRes.data ?? []) as LifecycleEvent[]) {
    if (!e.hcp_job_id) continue;
    const arr = lifecycleByJob.get(e.hcp_job_id) ?? [];
    arr.push(e);
    lifecycleByJob.set(e.hcp_job_id, arr);
  }
  const vanByDriver = new Map<string, string>(
    ((vansRes.data ?? []) as Array<{ display_name: string; primary_driver_short_name: string }>)
      .map((v) => [v.primary_driver_short_name, v.display_name]),
  );

  const formerSet = await getFormerTechNames();

  // Map pin arrays — server-side shaping so the client component stays dumb.
  const customerPins: CustomerPin[] = (
    (mapCustomersRes.data ?? []) as Array<{
      appointment_id: string | null; hcp_job_id: string | null;
      customer_name: string | null; street: string | null; city: string | null;
      scheduled_start: string; status: string | null; tech_primary_name: string | null;
      cust_lat: number | null; cust_lng: number | null;
    }>
  )
    .filter((r) => r.cust_lat != null && r.cust_lng != null)
    .map((r) => ({
      appointment_id: r.appointment_id,
      hcp_job_id: r.hcp_job_id,
      customer_name: r.customer_name,
      street: r.street,
      city: r.city,
      scheduled_start: r.scheduled_start,
      status: r.status,
      tech_primary_name: r.tech_primary_name,
      lat: Number(r.cust_lat),
      lng: Number(r.cust_lng),
    }));

  const vanPins: VanPin[] = (
    (vanPositionsRes.data ?? []) as Array<{
      vehicle_id: string; display_name: string;
      driver_short_name: string | null; driver_full_name: string | null;
      lat: number; lng: number; last_seen_at: string;
    }>
  ).map((v) => ({
    vehicle_id: v.vehicle_id,
    display_name: v.display_name,
    driver_short_name: v.driver_short_name,
    driver_full_name: v.driver_full_name,
    lat: Number(v.lat),
    lng: Number(v.lng),
    last_seen_at: v.last_seen_at,
  }));

  // Top-strip metrics
  const scheduledLast24h = last24hRows.length;
  const scheduledLast24hAmount = last24hRows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0) / 100;
  const todayCommitted = todayRows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0) / 100;
  // Today recognized = paid invoices whose job has an appt today
  const todayJobIds = new Set(todayRows.map((r) => r.hcp_job_id).filter(Boolean) as string[]);
  const todayRecognized = paidToday
    .filter((p) => todayJobIds.has(p.hcp_job_id))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0) / 100;
  // Open AR — invoices not yet paid. Use due_amount if known, fall back to amount.
  // Per variance audit 2026-05-13: ~$38k sitting here on completed jobs.
  const openArRows = (openArRes.data ?? []) as Array<{ amount: number; due_amount: number | null }>;
  const openArDollars = openArRows.reduce((s, r) => s + (Number(r.due_amount ?? r.amount) || 0), 0) / 100;
  const openArCount = openArRows.length;
  // Aged high-importance comms — variance audit V13. List for the banner.
  const agedHighImpRows = (agedHighImpRes.data ?? []) as Array<{
    id: number; occurred_at: string; channel: string | null; direction: string | null;
    customer_name: string | null; importance: number; summary: string | null;
    flags: string[] | null; tech_short_name: string | null;
  }>;
  const agedHighImpTotal = agedHighImpCountRes.count ?? agedHighImpRows.length;

  // Group today's appts by lane (primary tech for now; tech_all_names listed in card)
  const laneByTech = new Map<string, Appt[]>();
  for (const r of todayRows) {
    const key = r.tech_primary_name ?? "Unassigned";
    if (!laneByTech.has(key)) laneByTech.set(key, []);
    laneByTech.get(key)!.push(r);
  }
  // Render lanes for every active tech (even empty) so empty days are visible.
  // Order: lead techs first, then others. Unassigned appts get a lane at the end if non-empty.
  const techLaneOrder: string[] = [];
  for (const t of activeTechs) {
    if (t.hcp_full_name) techLaneOrder.push(t.hcp_full_name);
  }
  if (laneByTech.has("Unassigned")) techLaneOrder.push("Unassigned");
  // Also include any tech_primary_name appearing in today's appts that's not in active list
  for (const k of laneByTech.keys()) {
    if (!techLaneOrder.includes(k)) techLaneOrder.push(k);
  }

  // Today's revenue by tech
  const revenueByTechToday = new Map<string, number>();
  for (const r of todayRows) {
    if (!r.hcp_job_id || !r.tech_primary_name) continue;
    const paid = paidToday.filter((p) => p.hcp_job_id === r.hcp_job_id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (paid > 0) {
      revenueByTechToday.set(r.tech_primary_name, (revenueByTechToday.get(r.tech_primary_name) ?? 0) + paid);
    }
  }

  // Week-ahead grouping (reuse v0-pre layout)
  const weekGrouped = new Map<string, Appt[]>();
  for (const r of weekRows) {
    const key = chicagoDateKey(r.scheduled_start);
    if (!weekGrouped.has(key)) weekGrouped.set(key, []);
    weekGrouped.get(key)!.push(r);
  }
  const weekKeys = Array.from(weekGrouped.keys()).sort();

  return (
    <PageShell
      title="Dispatch"
      description={`Today · ${todayRows.length} appt${todayRows.length === 1 ? "" : "s"} across ${laneByTech.size} lane${laneByTech.size === 1 ? "" : "s"}`}
    >
      {/* TOP STRIP — intake + scheduling + revenue conversion + AR */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Link href="/admin/queue" className="rounded-2xl border border-neutral-200 bg-white p-3 hover:border-neutral-400 hover:shadow-sm">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Open intake</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{intakeCount}</div>
          <div className="text-xs text-neutral-500">flagged for follow-up</div>
        </Link>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Scheduled (24h)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{scheduledLast24h}</div>
          <div className="text-xs text-neutral-500">{scheduledLast24hAmount > 0 ? fmtMoney(scheduledLast24hAmount) + " booked" : "—"}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Today committed</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{fmtMoney(todayCommitted)}</div>
          <div className="text-xs text-neutral-500">sum of today&apos;s appts</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-xs uppercase tracking-wide text-emerald-700">Today recognized</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-900">{fmtMoney(todayRecognized)}</div>
          <div className="text-xs text-emerald-700/80">paid invoices · gravy</div>
        </div>
        <Link href="/admin/ar" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 hover:border-amber-400 hover:shadow-sm">
          <div className="text-xs uppercase tracking-wide text-amber-700">Open AR</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">{fmtMoney(openArDollars)}</div>
          <div className="text-xs text-amber-700/80">{openArCount} unpaid · click to chase</div>
        </Link>
      </div>

      {/* AGED HIGH-IMP COMMS — customer follow-ups that have been waiting > 24h */}
      {agedHighImpTotal > 0 && (
        <details className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4" open={agedHighImpTotal >= 10}>
          <summary className="cursor-pointer text-sm font-semibold text-red-900">
            ⚠ {agedHighImpTotal} high-importance follow-up{agedHighImpTotal === 1 ? "" : "s"} waiting &gt; 24h
            <span className="ml-2 font-normal text-red-900/70">click to expand · these need a human</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {agedHighImpRows.map((c) => {
              const hours = Math.floor((Date.now() - new Date(c.occurred_at).getTime()) / 3_600_000);
              const ageLabel = hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
              return (
                <li key={c.id} className="rounded-xl bg-white p-2 text-sm">
                  <div className="flex items-baseline gap-2 text-xs text-red-900/70">
                    <span className="font-mono font-semibold">{ageLabel} old</span>
                    <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">imp {c.importance}</span>
                    <span className="uppercase">{c.channel ?? "—"}{c.direction ? ` · ${c.direction}` : ""}</span>
                    {c.tech_short_name ? <span className="ml-auto text-neutral-600">{c.tech_short_name}</span> : null}
                  </div>
                  <div className="mt-1 font-medium text-neutral-900">{c.customer_name ?? "—"}</div>
                  <div className="text-xs text-neutral-700">{c.summary ?? "—"}</div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-red-900/70">
            Showing top {agedHighImpRows.length} of {agedHighImpTotal} —
            <Link href="/admin/queue" className="ml-1 font-medium underline">open full queue →</Link>
          </p>
        </details>
      )}

      {/* MAP — customer pins + van pins, color-coded by tech */}
      <DispatchMap customers={customerPins} vans={vanPins} />

      {/* LANES — column per tech */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-neutral-800">Today&apos;s lanes</h2>
        {techLaneOrder.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
            No active techs to render.
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-3">
            {techLaneOrder.map((techName) => {
              const lane = laneByTech.get(techName) ?? [];
              const shortName = activeTechs.find((t) => t.hcp_full_name === techName)?.tech_short_name
                ?? (techName === "Unassigned" ? "Unassigned" : techName.split(" ")[0]);
              const van = vanByDriver.get(shortName);
              const revenue = revenueByTechToday.get(techName) ?? 0;
              return (
                <div key={techName} className="flex w-72 shrink-0 flex-col rounded-2xl border border-neutral-200 bg-white">
                  <header className="border-b border-neutral-100 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-semibold text-neutral-900">{shortName}</div>
                      <div className="text-xs text-neutral-500">{lane.length} appt{lane.length === 1 ? "" : "s"}</div>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                      <span className="text-neutral-500">{van ? `🚐 ${van}` : <span className="text-neutral-400">no van</span>}</span>
                      {revenue > 0 ? <span className="font-medium text-emerald-700">{fmtMoney(revenue / 100)}</span> : null}
                    </div>
                  </header>
                  <div className="flex-1 space-y-2 p-2">
                    {lane.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-neutral-200 p-3 text-center text-xs text-neutral-400">
                        Open today
                      </div>
                    ) : lane.map((a) => {
                      const gps = a.appointment_id ? gpsByAppt.get(a.appointment_id) : undefined;
                      const lifecycleEvents = a.hcp_job_id ? (lifecycleByJob.get(a.hcp_job_id) ?? []) : [];
                      const state = techStateFromEvents(lifecycleEvents);
                      return (
                        <div key={a.appointment_id ?? a.hcp_job_id ?? Math.random()} className="rounded-xl border border-neutral-200 bg-neutral-50 p-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-xs font-medium text-neutral-700">{chicagoTime(a.scheduled_start)}</span>
                            <span title={techStateLabel(state)} className="text-sm">{state}</span>
                          </div>
                          <div className="mt-1">
                            {a.hcp_job_id ? (
                              <Link href={`/job/${a.hcp_job_id}`} className="block text-sm font-medium text-neutral-900 hover:underline">
                                {a.customer_name ?? "—"}
                              </Link>
                            ) : (
                              <span className="block text-sm font-medium text-neutral-900">{a.customer_name ?? "—"}</span>
                            )}
                          </div>
                          {a.street ? (
                            <div className="text-xs text-neutral-600">{a.street}{a.city ? `, ${a.city}` : ""}</div>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-baseline gap-2">
                            <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusTone(a.status)}`}>
                              {a.status ?? "—"}
                            </span>
                            {gps?.gps_matched ? (
                              <span title={gps.on_time === false ? `Arrived late · ${gps.time_on_site_minutes ?? "?"} min on site` : `On-site ${gps.time_on_site_minutes ?? "?"} min`}
                                    className="text-[10px] text-emerald-700">📍 GPS</span>
                            ) : null}
                            {(Number(a.total_amount) || 0) > 0 ? (
                              <span className="ml-auto text-xs font-medium text-neutral-700">{fmtMoney((Number(a.total_amount) || 0) / 100)}</span>
                            ) : null}
                          </div>
                          {a.tech_all_names && a.tech_all_names.length > 1 ? (
                            <div className="mt-1 text-[10px] text-neutral-500">+ {a.tech_all_names.filter((n) => n !== a.tech_primary_name).join(", ")}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* STALE — operational debt */}
      {staleRows.length > 0 && (
        <details className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-amber-900">
            Stale: {staleRows.length} appointment{staleRows.length === 1 ? "" : "s"} more than 7 days past with status still &quot;scheduled&quot; / &quot;needs scheduling&quot;
            <span className="ml-2 font-normal text-amber-900/70">(click to expand)</span>
          </summary>
          <ul className="mt-3 space-y-1 text-sm">
            {staleRows.map((s) => {
              const ageDays = Math.round((Date.now() - new Date(s.scheduled_start).getTime()) / 86_400_000);
              return (
                <li key={s.appointment_id ?? s.hcp_job_id ?? s.scheduled_start} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-amber-900/70">{ageDays}d ago</span>
                  {s.hcp_job_id ? (
                    <Link href={`/job/${s.hcp_job_id}`} className="font-medium text-amber-900 hover:underline">{s.customer_name ?? "—"}</Link>
                  ) : (
                    <span className="font-medium text-amber-900">{s.customer_name ?? "—"}</span>
                  )}
                  <span className="text-xs text-amber-900/70">
                    · {s.tech_primary_name ?? "—"}
                    {s.street ? ` · ${s.street}${s.city ? ", " + s.city : ""}` : ""}
                    · status: {s.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {/* WEEK AHEAD */}
      <details className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-neutral-800">
          Week ahead · {weekRows.length} appointment{weekRows.length === 1 ? "" : "s"} (tomorrow → +7d)
        </summary>
        <div className="mt-4 space-y-6">
          {weekKeys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-500">
              Nothing scheduled in the next 7 days.
            </div>
          ) : weekKeys.map((key) => {
            const dayRows = weekGrouped.get(key)!;
            const dayTotal = dayRows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0) / 100;
            const dayTechs = new Set(dayRows.map((r) => r.tech_primary_name).filter(Boolean));
            return (
              <div key={key}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-neutral-900">
                    {chicagoDateLabel(key)}
                    <span className="ml-2 text-xs font-normal text-neutral-500">{key}</span>
                  </h3>
                  <div className="text-xs text-neutral-500">
                    {dayRows.length} appt{dayRows.length === 1 ? "" : "s"} · {dayTechs.size} tech{dayTechs.size === 1 ? "" : "s"}
                    {dayTotal > 0 ? ` · ${fmtMoney(dayTotal)}` : ""}
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-neutral-200">
                  <table className="w-full text-sm">
                    <thead className="border-b border-neutral-200 bg-neutral-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-neutral-600">Time</th>
                        <th className="px-3 py-2 text-left font-medium text-neutral-600">Tech</th>
                        <th className="px-3 py-2 text-left font-medium text-neutral-600">Customer</th>
                        <th className="px-3 py-2 text-left font-medium text-neutral-600">Address</th>
                        <th className="px-3 py-2 text-left font-medium text-neutral-600">Status</th>
                        <th className="px-3 py-2 text-right font-medium text-neutral-600">$</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {dayRows.map((r) => (
                        <tr key={r.appointment_id ?? r.hcp_job_id ?? Math.random()} className="hover:bg-neutral-50">
                          <td className="px-3 py-2 align-top whitespace-nowrap font-mono text-xs text-neutral-700">{chicagoTime(r.scheduled_start)}</td>
                          <td className="px-3 py-2 align-top"><TechName name={r.tech_primary_name} formerSet={formerSet} /></td>
                          <td className="px-3 py-2 align-top">
                            {r.hcp_customer_id ? (
                              <Link href={`/customer/${r.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">{r.customer_name ?? "—"}</Link>
                            ) : (
                              <span className="font-medium text-neutral-900">{r.customer_name ?? "—"}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-neutral-700">{[r.street, r.city].filter(Boolean).join(", ") || "—"}</td>
                          <td className="px-3 py-2 align-top">
                            <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${statusTone(r.status)}`}>{r.status ?? "—"}</span>
                          </td>
                          <td className="px-3 py-2 align-top text-right font-medium text-neutral-700">{(Number(r.total_amount) || 0) > 0 ? fmtMoney((Number(r.total_amount) || 0) / 100) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      <p className="mt-4 text-xs text-neutral-500">
        v0 · read-only · drag-to-reassign + map coming in v1/v2.
      </p>
    </PageShell>
  );
}
