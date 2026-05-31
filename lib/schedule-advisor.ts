"use server";

// Stage B of the scheduling advisor: gather the deterministic fleet state and
// ask the schedule-advisor edge fn for ranked tech+time recommendations.
//
// Recommendation-only (Danny 2026-05-30) — the result informs the dispatcher,
// it never auto-assigns. Tech-fit v1 infers from recent work (job_360 scope
// notes); the `recent_work` field is the seam the future structured skillset
// (technician_skills / work_type_requirements, task #9/#10) swaps into.

import { db } from "./supabase";
import { requireScheduler } from "./current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type AdvisorJobInput = {
  description: string;
  customer_id?: string;
  customer_name?: string;
  address?: string;
  city?: string;
  date_chi: string;
  duration_min?: number;
  urgency?: string;
};

export type AdvisorRec = {
  tech_short_name: string;
  suggested_start_chi: string;
  fit_score: number;
  why: string;
  concerns?: string;
};

export type AdvisorResult =
  | { ok: true; recommendations: AdvisorRec[]; overall_note: string; unschedulable_reason?: string; elapsed_ms?: number }
  | { ok: false; error: string };

function chicagoOffsetForDate(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return -6;
  const second = nthSunday(y, 3, 2);
  const firstNov = nthSunday(y, 11, 1);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day >= second && day < firstNov ? -5 : -6;
}
function nthSunday(year: number, month1: number, n: number): Date {
  const dt = new Date(Date.UTC(year, month1 - 1, 1));
  const off = (7 - dt.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month1 - 1, 1 + off + 7 * (n - 1)));
}
function formatOffset(hours: number): string {
  const sign = hours >= 0 ? "+" : "-";
  const abs = Math.abs(hours);
  return `${sign}${String(Math.floor(abs)).padStart(2, "0")}:00`;
}

export async function recommendSchedule(job: AdvisorJobInput): Promise<AdvisorResult> {
  const gate = await requireScheduler();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!SERVICE_KEY) return { ok: false, error: "Server misconfigured — service key missing." };
  if (!job.description?.trim()) return { ok: false, error: "Job description required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(job.date_chi)) return { ok: false, error: "Valid target date required." };

  const supa = db();

  // 1. Active bookable techs (same set the booking dropdown uses).
  const { data: techRows } = await supa
    .from("tech_directory")
    .select("tech_short_name, hcp_full_name, is_lead")
    .eq("is_active", true)
    .neq("is_test", true)
    .in("dashboard_role", ["tech", "admin"])
    .not("hcp_employee_id", "is", null)
    .order("is_lead", { ascending: false })
    .order("tech_short_name");
  const techs = (techRows ?? []) as Array<{ tech_short_name: string; hcp_full_name: string | null; is_lead: boolean | null }>;
  if (techs.length === 0) return { ok: false, error: "No active techs to recommend." };
  const fullNames = techs.map((t) => t.hcp_full_name).filter((n): n is string => !!n);

  // 2. Booked windows for the target Chicago day, grouped by tech.
  const offset = chicagoOffsetForDate(job.date_chi);
  const dayStart = new Date(`${job.date_chi}T00:00:00${formatOffset(offset)}`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const apptsByTech = new Map<string, Array<{ start: string; end: string | null; customer: string | null }>>();
  if (!Number.isNaN(dayStart.getTime())) {
    const { data: apptRows } = await supa
      .from("appointments_master")
      .select("tech_primary_name, scheduled_start, scheduled_end, customer_name")
      .is("deleted_at", null)
      .gte("scheduled_start", dayStart.toISOString())
      .lt("scheduled_start", dayEnd.toISOString())
      .not("status", "in", "(canceled,Canceled,cancelled,Cancelled)")
      .order("scheduled_start", { ascending: true });
    for (const r of (apptRows ?? []) as Array<{ tech_primary_name: string | null; scheduled_start: string; scheduled_end: string | null; customer_name: string | null }>) {
      const name = r.tech_primary_name?.trim();
      if (!name) continue;
      if (!apptsByTech.has(name)) apptsByTech.set(name, []);
      apptsByTech.get(name)!.push({ start: r.scheduled_start, end: r.scheduled_end, customer: r.customer_name });
    }
  }

  // 3. Recent-work skill signal (best-effort — sparse where no SalesAsk).
  const recentByTech = new Map<string, string[]>();
  try {
    const { data: scopeRows } = await supa
      .from("job_360")
      .select("tech_primary_name, salesask_latest_scope_notes")
      .in("tech_primary_name", fullNames.length ? fullNames : ["__none__"])
      .not("salesask_latest_scope_notes", "is", null)
      .limit(400);
    for (const r of (scopeRows ?? []) as Array<{ tech_primary_name: string | null; salesask_latest_scope_notes: string | null }>) {
      const name = r.tech_primary_name?.trim();
      const note = r.salesask_latest_scope_notes?.trim();
      if (!name || !note) continue;
      const list = recentByTech.get(name) ?? [];
      if (list.length < 8 && !list.includes(note.slice(0, 120))) list.push(note.slice(0, 120));
      recentByTech.set(name, list);
    }
  } catch { /* best-effort skill signal */ }

  // 4. Last-known location per tech: prefer Bouncie van pin, fall back to in-app.
  const locByShort = new Map<string, { lat: number; lng: number; source: string; last_seen: string }>();
  const [{ data: vanPos }, { data: techPos }] = await Promise.all([
    supa.from("vehicle_last_known_position_v").select("driver_short_name, lat, lng, last_seen_at"),
    supa.from("tech_last_position_v").select("tech_short_name, lat, lng, last_at"),
  ]);
  for (const v of (vanPos ?? []) as Array<{ driver_short_name: string | null; lat: number | null; lng: number | null; last_seen_at: string | null }>) {
    if (v.driver_short_name && v.lat != null && v.lng != null) {
      locByShort.set(v.driver_short_name, { lat: v.lat, lng: v.lng, source: "van", last_seen: v.last_seen_at ?? "" });
    }
  }
  for (const t of (techPos ?? []) as Array<{ tech_short_name: string | null; lat: number | null; lng: number | null; last_at: string | null }>) {
    if (t.tech_short_name && t.lat != null && t.lng != null && !locByShort.has(t.tech_short_name)) {
      locByShort.set(t.tech_short_name, { lat: t.lat, lng: t.lng, source: "in-app", last_seen: t.last_at ?? "" });
    }
  }

  // 4b. Structured skills per tech (#9) — the advisor prefers these over the
  // sparse recent_work inference when present. Authored at /admin/skills.
  const skillsByShort = new Map<string, string[]>();
  try {
    const { data: tsRows } = await supa.from("tech_skills_v").select("tech_short_name, label").eq("is_active", true);
    for (const r of (tsRows ?? []) as Array<{ tech_short_name: string | null; label: string | null }>) {
      if (!r.tech_short_name || !r.label) continue;
      const list = skillsByShort.get(r.tech_short_name) ?? [];
      list.push(r.label);
      skillsByShort.set(r.tech_short_name, list);
    }
  } catch { /* skillset layer optional */ }

  // 5. Assemble fleet state.
  const fleetTechs = techs.map((t) => ({
    short_name: t.tech_short_name,
    full_name: t.hcp_full_name ?? undefined,
    is_lead: !!t.is_lead,
    day_appts: apptsByTech.get(t.hcp_full_name ?? "") ?? [],
    recent_work: recentByTech.get(t.hcp_full_name ?? "") ?? [],
    skills: skillsByShort.get(t.tech_short_name) ?? [],
    location: locByShort.get(t.tech_short_name) ?? null,
  }));

  // 6. Ask the advisor.
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/schedule-advisor`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        job: {
          description: job.description,
          customer_name: job.customer_name,
          address: job.address,
          city: job.city,
          date_chi: job.date_chi,
          duration_min: job.duration_min ?? 120,
          urgency: job.urgency,
        },
        fleet: {
          date_chi: job.date_chi,
          techs: fleetTechs,
          business_hours: { start: "08:00", end: "17:00" },
        },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? `schedule-advisor ${res.status}` };
    }
    return {
      ok: true,
      recommendations: Array.isArray(json.recommendations) ? json.recommendations : [],
      overall_note: json.overall_note ?? "",
      unschedulable_reason: json.unschedulable_reason ?? undefined,
      elapsed_ms: json.elapsed_ms,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
