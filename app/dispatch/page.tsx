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
import { DispatchMap, type CustomerPin, type VanPin, type TechPin } from "../../components/DispatchMap";
import { AdvisorBacklogPanel } from "../../components/AdvisorBacklogPanel";
import { recommendSchedule } from "../../lib/schedule-advisor";
import { DispatchAck } from "./DispatchAck";
import { RequestReportButton } from "../../components/RequestReportButton";
import { TechAvatar } from "../../components/TechAvatar";
import { DownloadCsvButton } from "../../components/DownloadCsvButton";
import { TaskList } from "../../components/TaskList";
import { NoteToDanny } from "../../components/NoteToDanny";
import { listTasks } from "../../lib/tasks";
import { isResolving, type DispatchAckStatus, type DispatchItemType } from "./dispositions";

export const metadata = { title: "Dispatch · TPAR-DB" };
export const dynamic = "force-dynamic";

type AckRow = {
  item_type: string;
  item_id: string;
  status: DispatchAckStatus;
  note: string | null;
  set_by_short_name: string | null;
  set_at: string;
};

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
function ackBorder(status: DispatchAckStatus | undefined): string {
  if (!status) return "border-neutral-200";
  if (isResolving(status)) return "border-emerald-200";
  switch (status) {
    case "needs_followup":   return "border-amber-300";
    case "needs_review":     return "border-sky-300";
    case "needs_advise":     return "border-violet-300";
    case "scheduled_active": return "border-blue-300";
    default:                 return "border-neutral-200";
  }
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

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ show_resolved?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const { show_resolved } = await searchParams;
  const hideResolved = show_resolved !== "1";  // resolving dispositions auto-collapse by default
  const canWriteAck = me.isAdmin || me.isManager || !!me.tech?.is_lead;

  const supa = db();

  const nowCtKey = new Date().toLocaleDateString("en-CA", { timeZone: CHI });
  const todayStartUtc = new Date(`${nowCtKey}T00:00:00-05:00`).toISOString();
  const todayEndUtc = new Date(new Date(`${nowCtKey}T00:00:00-05:00`).getTime() + 86_400_000).toISOString();
  const weekEndUtc = new Date(new Date(`${nowCtKey}T00:00:00-05:00`).getTime() + 7 * 86_400_000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const last24hAgo = new Date(Date.now() - 86_400_000).toISOString();

  // Internal-placeholder customers — pinned by hcp_customer_id, NOT customer_name.
  // The customer_name field is unreliable: 288 real HCP customers have empty first/last
  // names with company_name set to "Tulsa Plumbing and Remodeling" (template-default
  // bug at HCP creation time), which leaks into appointments_master.customer_name via
  // hcp-sync-appointments' company_name fallback. Name-matching would falsely flag 78
  // real-customer appointments as internal. Use customer_id allowlist instead.
  //
  // cus_051289... = TPAR On-Call placeholder (1515 E 6th St). Add new internal IDs here.
  const INTERNAL_CUSTOMER_IDS = new Set(["cus_051289f5b070471bbbe475ddc9e60a18"]);
  const testCustomerSql = '("cus_9cf8cc5b02e1430a85288b034763cc19","cus_386a644b8054483788825c86c1b13b9c")';
  const cancelStatusSql = '("pro canceled","user canceled","cancelled","canceled","Pro Canceled","User Canceled","Cancelled","Canceled")';
  const isInternalAppt = (hcp_customer_id?: string | null) => !!hcp_customer_id && INTERNAL_CUSTOMER_IDS.has(hcp_customer_id);

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
    techLastPosRes,
    adherenceFarRes,
    openArRes,
    agedHighImpRes,
    agedHighImpCountRes,
    needsSchedulingRes,
    acksRes,
  ] = await Promise.all([
    // Today's appts (Chicago day, no cancels, no test customers). Internal placeholders
    // (Tulsa Plumbing and Remodeling, etc.) are KEPT and tagged via isInternalAppt — they
    // represent real internal work (HQ tasks, training, equipment) techs do during the day.
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, scheduled_end, status, appointment_type, tech_primary_name, tech_all_names, customer_name, street, city, total_amount, flags")
      .is("deleted_at", null)
      .gte("scheduled_start", todayStartUtc)
      .lt("scheduled_start", todayEndUtc)
      .not("status", "in", cancelStatusSql)
      .not("hcp_customer_id", "in", testCustomerSql)
      .order("scheduled_start", { ascending: true }),
    // Week ahead (tomorrow → +7d) — internal placeholders included + tagged
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, scheduled_end, status, appointment_type, tech_primary_name, tech_all_names, customer_name, street, city, total_amount, flags")
      .is("deleted_at", null)
      .gte("scheduled_start", todayEndUtc)
      .lt("scheduled_start", weekEndUtc)
      .not("status", "in", cancelStatusSql)
      .not("hcp_customer_id", "in", testCustomerSql)
      .order("scheduled_start", { ascending: true }),
    // Stale appointments (operational debt): 7-60d window only. >60d items are
    // legacy invoice-segment IDs that don't exist in hcp_jobs_raw anymore — they
    // never re-sync, so their status is frozen and useless as a signal. Cap to
    // actionable age.
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, status, tech_primary_name, customer_name, street, city")
      .is("deleted_at", null)
      .lt("scheduled_start", sevenDaysAgo)
      .gte("scheduled_start", sixtyDaysAgo)
      .in("status", ["scheduled", "Scheduled", "needs scheduling", "Needs Scheduling"])
      .not("hcp_customer_id", "in", testCustomerSql)
      .order("scheduled_start", { ascending: false })
      .limit(40),
    // Scheduling activity in the last 24h — proxy for Madisson's work
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, total_amount", { count: "exact", head: false })
      .is("deleted_at", null)
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
      .select("tech_short_name, hcp_full_name, dashboard_role, is_lead, is_active, avatar_url")
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
    // Latest tech ping per tech (in-app GPS capture) — last 8h window so stale techs drop off.
    supa
      .from("tech_last_position_v")
      .select("tech_email, tech_short_name, tech_full_name, lat, lng, last_action, last_at, hcp_job_id")
      .gte("last_at", new Date(Date.now() - 8 * 3_600_000).toISOString()),
    // Lifecycle adherence flags — trigger pressed > 0.5 mi from the job site, last 24h.
    supa
      .from("lifecycle_adherence_v")
      .select("id, captured_at, tech_short_name, action_type, hcp_job_id, customer_name, miles_from_site")
      .eq("adherence_flag", "far")
      .gte("captured_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order("captured_at", { ascending: false })
      .limit(20),
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
      .select("id, occurred_at, channel, direction, customer_name, hcp_customer_id, importance, summary, flags, tech_short_name")
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
    // Unscheduled backlog: HCP jobs with status='needs scheduling' and no scheduled_start.
    // Madisson's actionable queue. We pull from hcp_jobs_raw because these jobs never
    // make it into appointments_master (no schedule = no row). Excludes the 333 dead
    // jobs (pro-cancelled / completed) that also have null scheduled_start.
    supa
      .from("hcp_jobs_raw")
      .select("hcp_job_id, hcp_customer_id, status, raw, hcp_notes, last_synced_at")
      .is("scheduled_start", null)
      .eq("status", "needs scheduling")
      .limit(100),
    // All dispatch_acks — small table, fetch all and bucket client-side
    supa
      .from("dispatch_acks")
      .select("item_type, item_id, status, note, set_by_short_name, set_at"),
  ]);

  const ackRows = (acksRes.data ?? []) as AckRow[];
  const ackByKey = new Map<string, AckRow>();
  for (const a of ackRows) ackByKey.set(`${a.item_type}:${a.item_id}`, a);
  const resolvedCount = Array.from(ackByKey.values()).filter((a) => isResolving(a.status)).length;
  function getAck(item_type: DispatchItemType, item_id: string | null | undefined): AckRow | null {
    if (!item_id) return null;
    return ackByKey.get(`${item_type}:${item_id}`) ?? null;
  }
  function isAddressed(item_type: DispatchItemType, item_id: string | null | undefined): boolean {
    return getAck(item_type, item_id)?.status === "addressed";
  }

  const todayRows = (todayRes.data ?? []) as Appt[];
  const weekRows = (weekRes.data ?? []) as Appt[];
  const staleRows = (staleRes.data ?? []) as Array<{
    appointment_id: string | null; hcp_job_id: string | null; hcp_customer_id: string | null;
    scheduled_start: string; status: string | null; tech_primary_name: string | null;
    customer_name: string | null; street: string | null; city: string | null;
  }>;
  type NeedsSchedRow = {
    hcp_job_id: string; hcp_customer_id: string | null; status: string;
    raw: Record<string, unknown>; hcp_notes: string | null; last_synced_at: string;
  };
  const needsSchedulingRows = ((needsSchedulingRes.data ?? []) as NeedsSchedRow[])
    .map((r) => {
      const raw = (r.raw ?? {}) as Record<string, unknown>;
      const customer = (raw.customer ?? {}) as Record<string, unknown>;
      const address = (raw.address ?? {}) as Record<string, unknown>;
      const createdAt = typeof raw.created_at === "string" ? raw.created_at : null;
      const firstName = typeof customer.first_name === "string" ? customer.first_name : "";
      const lastName = typeof customer.last_name === "string" ? customer.last_name : "";
      const fullName = `${firstName} ${lastName}`.trim() || (typeof customer.company === "string" ? customer.company : "") || "(no customer)";
      return {
        hcp_job_id: r.hcp_job_id,
        hcp_customer_id: r.hcp_customer_id,
        customer_name: fullName,
        street: typeof address.street === "string" ? address.street : "",
        city: typeof address.city === "string" ? address.city : "",
        created_at: createdAt,
        age_days: createdAt ? Math.round((Date.now() - new Date(createdAt).getTime()) / 86_400_000) : null,
        notes_preview: (r.hcp_notes ?? "").slice(0, 140),
      };
    })
    .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0)); // oldest first — most overdue
  const last24hRows = (last24hRes.data ?? []) as Array<{ total_amount: number | null }>;
  const intakeCount = intakeRes.count ?? 0;
  const paidToday = (paidTodayRes.data ?? []) as Array<{ hcp_job_id: string; amount: number }>;
  const activeTechs = (activeTechsRes.data ?? []) as Array<{ tech_short_name: string; hcp_full_name: string; is_lead: boolean | null; avatar_url: string | null }>;
  const avatarByFullName = new Map<string, string | null>(activeTechs.map((t) => [t.hcp_full_name, t.avatar_url ?? null]));
  const dispatchTasks = await listTasks();
  const taskTechNames = activeTechs.map((t) => t.tech_short_name);
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

  const techPins: TechPin[] = (
    (techLastPosRes.data ?? []) as Array<{
      tech_email: string; tech_short_name: string | null; tech_full_name: string | null;
      lat: number; lng: number; last_action: string; last_at: string; hcp_job_id: string | null;
    }>
  ).map((t) => ({
    id: t.tech_email,
    tech_short_name: t.tech_short_name,
    tech_full_name: t.tech_full_name,
    lat: Number(t.lat),
    lng: Number(t.lng),
    last_action: t.last_action,
    last_at: t.last_at,
    hcp_job_id: t.hcp_job_id,
  }));

  const adherenceFlags = (adherenceFarRes.data ?? []) as Array<{
    id: string; captured_at: string; tech_short_name: string | null;
    action_type: string; hcp_job_id: string | null; customer_name: string | null;
    miles_from_site: number | null;
  }>;

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
    customer_name: string | null; hcp_customer_id: string | null; importance: number; summary: string | null;
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
      title="🚐 Dispatch"
      titleClassName="text-3xl font-bold tracking-tight text-neutral-900 md:text-4xl"
      description={`Today · ${todayRows.length} appt${todayRows.length === 1 ? "" : "s"} across ${laneByTech.size} lane${laneByTech.size === 1 ? "" : "s"}`}
      help={{
        intent: "Today's flight deck. Where everyone is, what's open, what's owed. Map + per-tech lanes + the dollars side of the day.",
        actions: [
          "Map shows van pins (Bouncie) + customer pins (today's jobs). Click a pin for details.",
          "Tech lanes show each tech's day vertically — clicking a job opens the full /job page.",
          "Top strip = intake to triage / today's revenue / open AR. Each tile is a link.",
          "If a customer is unreachable or running long, reach the assigned tech or escalate to the owner.",
        ],
        stuck: <>Map blank? GPS pipeline likely paused; check /admin/system pipeline freshness or text Danny.</>,
      }}
    >
      {/* STICKY ACTION BAR — full-width dispatch actions */}
      <div className="sticky top-0 z-30 -mx-4 mb-4 flex items-stretch gap-2 border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <Link href="/ask" className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100">🔎 Ask</Link>
        <Link href="/dispatch/new-event" className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100">📅 Create event</Link>
        <Link href="/dispatch/new-job" className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">🧰 Create job</Link>
        <Link href="/dispatch/new-estimate" className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100">📝 Create estimate</Link>
        <button type="button" disabled title="Coming soon — needs bot endpoint for assignment (HCP API doesn't expose it)" className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-400">👷 Assign tech (soon)</button>
        <Link
          href={hideResolved ? "/dispatch?show_resolved=1" : "/dispatch"}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold ${hideResolved ? "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50" : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"}`}
          title={hideResolved ? "Resolved items (declined / done / deferred / awaiting-client / etc.) are hidden. Click to show them." : "Showing resolved items. Click to hide them again."}
        >
          {hideResolved ? `✅ Show resolved${resolvedCount ? ` (${resolvedCount})` : ""}` : "✅ Showing resolved"}
        </Link>
      </div>

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
          <div className="text-xs text-emerald-700/80">paid invoices</div>
        </div>
        <Link href="/admin/ar" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 hover:border-amber-400 hover:shadow-sm">
          <div className="text-xs uppercase tracking-wide text-amber-700">Open AR</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">{fmtMoney(openArDollars)}</div>
          <div className="text-xs text-amber-700/80">{openArCount} unpaid · click to chase</div>
        </Link>
      </div>

      {/* MAP (left) + HIGH-IMPORTANCE FOLLOW-UPS (right, scrollable to-do window) */}
      <div className="mb-6 grid items-start gap-4 lg:grid-cols-2">
        <DispatchMap customers={customerPins} vans={vanPins} techs={techPins} />

        <div className="flex h-[460px] flex-col rounded-2xl border border-red-200 bg-red-50 p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-red-900">
              ⚠ Follow-ups{agedHighImpTotal > 0 ? ` · ${agedHighImpTotal}` : ""}
              <span className="ml-1 text-xs font-normal text-red-900/70">high-importance · waiting &gt;24h</span>
            </h3>
            <Link href="/admin/queue" className="shrink-0 text-xs font-medium text-red-800 underline hover:text-red-900">full queue →</Link>
          </div>
          {agedHighImpTotal === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-red-900/60">✓ Nothing waiting</div>
          ) : (() => {
            const renderComm = (c: typeof agedHighImpRows[number]) => {
              const ack = getAck("comm_event", String(c.id));
              if (hideResolved && isResolving(ack?.status)) return null;
              const dimmed = isResolving(ack?.status);
              const hours = Math.floor((Date.now() - new Date(c.occurred_at).getTime()) / 3_600_000);
              const ageLabel = hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
              return (
                <li key={c.id} className={`rounded-xl border bg-white p-2 text-sm ${ackBorder(ack?.status)} ${dimmed ? "opacity-60" : ""}`}>
                  <div className="flex items-baseline gap-2 text-xs text-red-900/70">
                    <span className="font-mono font-semibold">{ageLabel} old</span>
                    <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">imp {c.importance}</span>
                    <span className="uppercase">{c.channel ?? "—"}{c.direction ? ` · ${c.direction}` : ""}</span>
                    {c.tech_short_name ? <span className="text-neutral-600">{c.tech_short_name}</span> : null}
                    <span className="ml-auto flex items-center gap-1">
                      {canWriteAck ? <RequestReportButton hcpCustomerId={c.hcp_customer_id} /> : null}
                      <DispatchAck itemType="comm_event" itemId={String(c.id)} existing={ack} canWrite={canWriteAck} />
                    </span>
                  </div>
                  <div className="mt-1 font-medium text-neutral-900">{c.customer_name ?? "—"}</div>
                  <div className="text-xs text-neutral-700">{c.summary ?? "—"}</div>
                  {ack?.note ? <div className="mt-1 text-[11px] italic text-neutral-700">“{ack.note}”</div> : null}
                </li>
              );
            };
            const sorted = [...agedHighImpRows].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
            return (
              <>
                <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
                  {sorted.map(renderComm)}
                </ul>
                <p className="mt-2 shrink-0 text-center text-[10px] text-red-900/60">top {agedHighImpRows.length} of {agedHighImpTotal} · oldest first</p>
              </>
            );
          })()}
        </div>
      </div>

      {/* ADHERENCE FLAGS — lifecycle triggers pressed far from the job (24h) */}
      {adherenceFlags.length > 0 ? (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-amber-900">
              ⚠ Adherence flags · last 24h
            </h3>
            <span className="text-xs text-amber-700">
              Lifecycle trigger pressed &gt; 0.5 mi from the job site
            </span>
          </div>
          <ul className="space-y-1.5">
            {adherenceFlags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                  {f.action_type}
                </span>
                <span className="font-medium text-amber-900">{f.tech_short_name ?? "?"}</span>
                <span className="text-amber-800">
                  {f.miles_from_site != null ? `${f.miles_from_site.toFixed(1)} mi from` : "far from"} {f.customer_name ?? "site"}
                </span>
                {f.hcp_job_id ? (
                  <a href={`/job/${f.hcp_job_id}`} className="text-xs text-amber-700 hover:underline">
                    open job →
                  </a>
                ) : null}
                <span className="ml-auto text-xs text-amber-700">
                  {new Date(f.captured_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* High-importance follow-ups now render in the map row above (Phase 2). */}

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
                      <div className="flex items-center gap-2">
                        <TechAvatar shortName={shortName} avatarUrl={avatarByFullName.get(techName) ?? null} />
                        <div className="font-semibold text-neutral-900">{shortName}</div>
                      </div>
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
                      const ack = getAck("appointment", a.appointment_id);
                      if (hideResolved && isResolving(ack?.status)) return null;
                      const dimmed = isResolving(ack?.status);
                      return (
                        <div key={a.appointment_id ?? a.hcp_job_id ?? Math.random()} className={`rounded-xl border bg-neutral-50 p-2 ${ackBorder(ack?.status)} ${dimmed ? "opacity-60" : ""}`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-xs font-medium text-neutral-700">{chicagoTime(a.scheduled_start)}</span>
                            <span title={techStateLabel(state)} className="text-sm">{state}</span>
                          </div>
                          <div className="mt-1 flex items-baseline gap-1.5">
                            {a.hcp_job_id ? (
                              <Link href={`/job/${a.hcp_job_id}`} className="text-sm font-medium text-neutral-900 hover:underline">
                                {a.customer_name ?? "—"}
                              </Link>
                            ) : (
                              <span className="text-sm font-medium text-neutral-900">{a.customer_name ?? "—"}</span>
                            )}
                            {isInternalAppt(a.hcp_customer_id) && (
                              <span className="rounded-md bg-violet-100 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-violet-800">internal</span>
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
                              <span className="text-xs font-medium text-neutral-700">{fmtMoney((Number(a.total_amount) || 0) / 100)}</span>
                            ) : null}
                            {a.appointment_id ? (
                              <span className="ml-auto"><DispatchAck itemType="appointment" itemId={a.appointment_id} existing={ack} canWrite={canWriteAck} /></span>
                            ) : null}
                          </div>
                          {ack?.note ? <div className="mt-1 text-[11px] italic text-neutral-700">“{ack.note}”</div> : null}
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

      {/* STALE — Layer 2 decay: split <14d vs 14+d */}
      {staleRows.length > 0 && (() => {
        const FOURTEEN_DAYS_MS = 14 * 86_400_000;
        const renderStale = (s: typeof staleRows[number]) => {
          const ack = getAck("stale_appointment", s.appointment_id);
          if (hideResolved && isResolving(ack?.status)) return null;
          const dimmed = isResolving(ack?.status);
          const ageDays = Math.round((Date.now() - new Date(s.scheduled_start).getTime()) / 86_400_000);
          return (
            <li key={s.appointment_id ?? s.hcp_job_id ?? s.scheduled_start} className={`flex flex-wrap items-baseline gap-2 ${dimmed ? "opacity-60" : ""}`}>
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
              {s.appointment_id ? (
                <span className="ml-auto"><DispatchAck itemType="stale_appointment" itemId={s.appointment_id} existing={ack} canWrite={canWriteAck} /></span>
              ) : null}
              {ack?.note ? <span className="w-full pl-12 text-[11px] italic text-amber-900/80">“{ack.note}”</span> : null}
            </li>
          );
        };
        const fresh = staleRows.filter(s => (Date.now() - new Date(s.scheduled_start).getTime()) < FOURTEEN_DAYS_MS);
        const older = staleRows.filter(s => (Date.now() - new Date(s.scheduled_start).getTime()) >= FOURTEEN_DAYS_MS);
        return (
          <details className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-amber-900">
              Stale: {staleRows.length} appointment{staleRows.length === 1 ? "" : "s"} (7-60d past, still &quot;scheduled&quot; / &quot;needs scheduling&quot;)
              <span className="ml-2 font-normal text-amber-900/70">{fresh.length} recent (≤14d) · {older.length} older (14+d) · click to expand</span>
            </summary>
            <ul className="mt-3 space-y-1 text-sm">
              {fresh.map(renderStale)}
            </ul>
            {older.length > 0 && (
              <details className="mt-3 rounded-xl border border-amber-300 bg-amber-100/50 p-2">
                <summary className="cursor-pointer text-xs font-medium text-amber-900">
                  Older (14+ days · {older.length}) — collapsed by default
                </summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {older.map(renderStale)}
                </ul>
              </details>
            )}
          </details>
        );
      })()}

      {/* NEEDS SCHEDULING + ADVISOR — side by side (Madisson works the backlog) */}
      {needsSchedulingRows.length > 0 && (
      <div className="mb-6 grid items-start gap-4 lg:grid-cols-2">
        <AdvisorBacklogPanel
          jobs={needsSchedulingRows.map((j) => ({ hcp_job_id: j.hcp_job_id, customer_name: j.customer_name, city: j.city, street: j.street, notes_preview: j.notes_preview, age_days: j.age_days }))}
          recommend={recommendSchedule}
        />
        {(() => {
        const renderNeed = (j: typeof needsSchedulingRows[number]) => {
          const ack = getAck("needs_scheduling", j.hcp_job_id);
          if (hideResolved && isResolving(ack?.status)) return null;
          const dimmed = isResolving(ack?.status);
          return (
            <li key={j.hcp_job_id} className={`flex flex-wrap items-baseline gap-2 ${dimmed ? "opacity-60" : ""}`}>
              <span className="font-mono text-xs text-sky-900/70">{j.age_days != null ? `${j.age_days}d ago` : "—"}</span>
              {j.hcp_customer_id ? (
                <Link href={`/customer/${j.hcp_customer_id}`} className="font-medium text-sky-900 hover:underline">{j.customer_name}</Link>
              ) : (
                <span className="font-medium text-sky-900">{j.customer_name}</span>
              )}
              {j.street ? (
                <span className="text-xs text-sky-900/80">· {j.street}{j.city ? `, ${j.city}` : ""}</span>
              ) : (
                <span className="text-xs text-sky-900/60">· (no address)</span>
              )}
              <Link href={`/job/${j.hcp_job_id}`} className="font-mono text-[10px] text-sky-700 hover:underline">{j.hcp_job_id.slice(0, 12)}…</Link>
              <span className="ml-auto flex items-center gap-1">
                {canWriteAck ? <RequestReportButton hcpCustomerId={j.hcp_customer_id} /> : null}
                <DispatchAck itemType="needs_scheduling" itemId={j.hcp_job_id} existing={ack} canWrite={canWriteAck} />
              </span>
              {(j.notes_preview || ack?.note) ? (
                <span className="w-full pl-12 text-xs italic text-sky-900/70">
                  {ack?.note ? `“${ack.note}”` : `“${j.notes_preview}”`}
                </span>
              ) : null}
            </li>
          );
        };
        const fresh = needsSchedulingRows.filter(j => (j.age_days ?? 0) < 30);
        const older = needsSchedulingRows.filter(j => (j.age_days ?? 0) >= 30);
        return (
          <details className="rounded-2xl border border-sky-200 bg-sky-50 p-4" open>
            <summary className="cursor-pointer text-sm font-semibold text-sky-900">
              Needs scheduling · {needsSchedulingRows.length} job{needsSchedulingRows.length === 1 ? "" : "s"}
              <span className="ml-2 font-normal text-sky-900/70">{fresh.length} recent (≤30d) · {older.length} older (30+d) · no calendar entry yet</span>
            </summary>
            <ul className="mt-3 space-y-1.5 text-sm">
              {fresh.map(renderNeed)}
            </ul>
            {older.length > 0 && (
              <details className="mt-3 rounded-xl border border-sky-300 bg-sky-100/50 p-2">
                <summary className="cursor-pointer text-xs font-medium text-sky-900">
                  Older (30+ days · {older.length}) — collapsed by default
                </summary>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {older.map(renderNeed)}
                </ul>
              </details>
            )}
          </details>
        );
      })()}
      </div>
      )}

      {/* WEEK AHEAD */}
      <details className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-neutral-800">
          Week ahead · {weekRows.length} appointment{weekRows.length === 1 ? "" : "s"} (tomorrow → +7d)
        </summary>
        <div className="mt-3">
          <DownloadCsvButton
            filename={`week-ahead-${new Date().toISOString().slice(0, 10)}.csv`}
            headers={["Date", "Time", "Tech", "Customer", "Address", "Status", "Amount"]}
            rows={weekRows.map((r) => [
              r.scheduled_start ? new Date(r.scheduled_start).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : "",
              r.scheduled_start ? chicagoTime(r.scheduled_start) : "",
              r.tech_primary_name ?? "",
              r.customer_name ?? "",
              [r.street, r.city].filter(Boolean).join(", "),
              r.status ?? "",
              (Number(r.total_amount) || 0) > 0 ? ((Number(r.total_amount) || 0) / 100).toFixed(2) : "",
            ])}
          />
        </div>
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
                        <th className="px-3 py-2 text-right font-medium text-neutral-600">Ack</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {dayRows.map((r) => {
                        const ack = getAck("appointment", r.appointment_id);
                        if (hideResolved && isResolving(ack?.status)) return null;
                        const dimmed = isResolving(ack?.status);
                        return (
                          <tr key={r.appointment_id ?? r.hcp_job_id ?? Math.random()} className={`hover:bg-neutral-50 ${dimmed ? "opacity-60" : ""}`}>
                            <td className="px-3 py-2 align-top whitespace-nowrap font-mono text-xs text-neutral-700">{chicagoTime(r.scheduled_start)}</td>
                            <td className="px-3 py-2 align-top">
                              <span className="flex items-center gap-2">
                                <TechAvatar shortName={r.tech_primary_name ?? "?"} avatarUrl={avatarByFullName.get(r.tech_primary_name ?? "") ?? null} size={22} />
                                <TechName name={r.tech_primary_name} formerSet={formerSet} />
                              </span>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <span className="flex items-baseline gap-2">
                                {r.hcp_customer_id ? (
                                  <Link href={`/customer/${r.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">{r.customer_name ?? "—"}</Link>
                                ) : (
                                  <span className="font-medium text-neutral-900">{r.customer_name ?? "—"}</span>
                                )}
                                {isInternalAppt(r.hcp_customer_id) && (
                                  <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800">internal</span>
                                )}
                              </span>
                              {ack?.note ? <div className="mt-0.5 text-[11px] italic text-neutral-700">“{ack.note}”</div> : null}
                            </td>
                            <td className="px-3 py-2 align-top text-neutral-700">{[r.street, r.city].filter(Boolean).join(", ") || "—"}</td>
                            <td className="px-3 py-2 align-top">
                              <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${statusTone(r.status)}`}>{r.status ?? "—"}</span>
                            </td>
                            <td className="px-3 py-2 align-top text-right font-medium text-neutral-700">{(Number(r.total_amount) || 0) > 0 ? fmtMoney((Number(r.total_amount) || 0) / 100) : ""}</td>
                            <td className="px-3 py-2 align-top text-right">
                              {r.appointment_id ? <DispatchAck itemType="appointment" itemId={r.appointment_id} existing={ack} canWrite={canWriteAck} /> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {/* TASK LIST + NOTE TO DANNY (Danny 2026-05-31) */}
      {canWriteAck ? (
        <div className="mb-6 grid items-start gap-4 lg:grid-cols-2">
          <TaskList tasks={dispatchTasks} techNames={taskTechNames} />
          <NoteToDanny />
        </div>
      ) : null}

      <p className="mt-4 text-xs text-neutral-500">
        v0 · read-only · drag-to-reassign + map coming in v1/v2.
      </p>
    </PageShell>
  );
}
