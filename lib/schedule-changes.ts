"use server";

// Schedule change requests (#21 front-end). Queue a reschedule proposal from the
// /schedule UI — TPAR-side only; the HCP write is gated on the bot endpoint, so
// these are pending proposals the dispatcher reviews. Admin/manager gated.

import { db } from "@/lib/supabase";
import { getCurrentTech, requireOwner } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type PendingChange = {
  id: string;
  appointment_id: string | null;
  hcp_job_id: string | null;
  kind: string;
  proposed_date: string | null;
  proposed_start_time: string | null;
  proposed_tech: string | null;
  customer_name: string | null;
  current_start: string | null;
  requested_by: string | null;
};
type Res = { ok: boolean; error?: string };

async function gate() {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return null;
  return me;
}

export async function requestReschedule(input: {
  appointment_id: string;
  hcp_job_id?: string | null;
  customer_name?: string | null;
  current_start?: string | null;
  proposed_date: string;
  proposed_time: string;
  note?: string;
}): Promise<Res> {
  const me = await gate();
  if (!me) return { ok: false, error: "dispatch role required" };
  if (!input.appointment_id || !input.proposed_time) return { ok: false, error: "missing appointment or time" };
  const supa = db();
  // One open proposal per appointment — supersede any prior pending one.
  await supa.from("schedule_change_requests").update({ status: "dismissed" }).eq("appointment_id", input.appointment_id).eq("status", "pending");
  const { error } = await supa.from("schedule_change_requests").insert({
    appointment_id: input.appointment_id,
    hcp_job_id: input.hcp_job_id ?? null,
    kind: "reschedule",
    current_start: input.current_start ?? null,
    proposed_date: input.proposed_date,
    proposed_start_time: input.proposed_time,
    customer_name: input.customer_name ?? null,
    note: input.note ?? null,
    requested_by: me.tech?.tech_short_name ?? me.email,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schedule");
  return { ok: true };
}

// Drag-a-job-to-propose (#21): dropping an appointment on a different (tech, day)
// cell queues a reschedule (day changed) or reassign (tech changed) proposal,
// preserving the time-of-day. No-op if dropped in place.
export async function proposeJobMove(input: {
  appointment_id: string;
  hcp_job_id?: string | null;
  customer_name?: string | null;
  current_start: string;   // ISO
  current_tech: string;    // hcp_full_name
  current_date: string;    // YYYY-MM-DD (Chicago day it's on)
  new_tech: string;        // hcp_full_name of the drop row
  new_date: string;        // YYYY-MM-DD of the drop day
}): Promise<Res> {
  const me = await gate();
  if (!me) return { ok: false, error: "dispatch role required" };
  if (!input.appointment_id) return { ok: false, error: "no appointment" };
  const techChanged = !!input.new_tech && input.new_tech !== input.current_tech && input.new_tech !== "Unassigned";
  const dateChanged = !!input.new_date && input.new_date !== input.current_date;
  if (!techChanged && !dateChanged) return { ok: true }; // dropped in place
  // Preserve the current time-of-day (Chicago) on a move.
  const proposedTime = new Date(input.current_start).toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).slice(0, 5);
  const supa = db();
  await supa.from("schedule_change_requests").update({ status: "dismissed" }).eq("appointment_id", input.appointment_id).eq("status", "pending");
  const { error } = await supa.from("schedule_change_requests").insert({
    appointment_id: input.appointment_id,
    hcp_job_id: input.hcp_job_id ?? null,
    kind: techChanged ? "reassign" : "reschedule",
    current_start: input.current_start,
    proposed_date: input.new_date,
    proposed_start_time: proposedTime,
    proposed_tech: techChanged ? input.new_tech : null,
    customer_name: input.customer_name ?? null,
    requested_by: me.tech?.tech_short_name ?? me.email,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schedule");
  return { ok: true };
}

export async function dismissChangeRequest(id: string): Promise<Res> {
  const me = await gate();
  if (!me) return { ok: false, error: "dispatch role required" };
  const { error } = await db().from("schedule_change_requests").update({ status: "dismissed" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schedule");
  return { ok: true };
}

export async function listPendingChanges(): Promise<PendingChange[]> {
  const me = await gate();
  if (!me) return [];
  const { data } = await db()
    .from("schedule_change_requests")
    .select("id, appointment_id, hcp_job_id, kind, proposed_date, proposed_start_time, proposed_tech, customer_name, current_start, requested_by")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data ?? []) as PendingChange[];
}

// Apply a pending proposal to HCP (#21 worker). Owner-gated for Phase 1: this
// pushes a real change to a customer's job (reschedule = new schedule, reassign
// = new assigned employee) through the update-hcp-job edge fn, then marks the
// row 'applied' and bounces hcp-sync-appointments so /schedule reflects it.
// Widen to schedulers once the REST write path is proven on a safe job.
export async function applyChangeRequest(id: string): Promise<Res> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "Server misconfigured — SUPABASE_URL/SERVICE_KEY missing." };

  const supa = db();

  // Atomically CLAIM the row (pending -> applying) BEFORE any HCP write, so a
  // double-click / second tab / retry can't fire the customer-facing write
  // twice. Only the invocation that flips the row wins.
  const { data: row } = await supa
    .from("schedule_change_requests")
    .update({ status: "applying" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, appointment_id, hcp_job_id, kind, current_start, proposed_date, proposed_start_time, proposed_tech")
    .maybeSingle();
  if (!row) return { ok: false, error: "already applied, dismissed, or in progress" };

  // Any pre-write bailout must release the claim so the proposal reappears.
  const release = async () => { await supa.from("schedule_change_requests").update({ status: "pending" }).eq("id", id); };

  // HCP job id — the row carries it; fall back to parsing the job:<id>:... key.
  let hcpJobId = (row.hcp_job_id ?? "").trim();
  if (!hcpJobId && row.appointment_id) {
    const m = String(row.appointment_id).match(/^job:([^:]+):/);
    if (m) hcpJobId = m[1];
  }
  if (!hcpJobId) { await release(); return { ok: false, error: "no HCP job id on this proposal" }; }

  // The SPECIFIC appointment being moved (a job can have several appointment
  // rows) — by appointment_id when present, else the job's latest. Used to
  // preserve the visit duration on a reschedule.
  const apptBase = supa.from("appointments_master").select("scheduled_start, scheduled_end").is("deleted_at", null);
  const { data: appt } = row.appointment_id
    ? await apptBase.eq("appointment_id", row.appointment_id).maybeSingle()
    : await apptBase.eq("hcp_job_id", hcpJobId).order("scheduled_start", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();

  const updateBody: Record<string, unknown> = {
    hcp_job_id: hcpJobId,
    reason: `schedule_change_requests ${id} applied by ${owner.email}`,
  };

  // New slot (Chicago wall-clock -> UTC). Only include schedule if the time
  // actually moves, so a pure reassign doesn't re-write (and possibly re-notify
  // on) the schedule.
  const dayKey = row.proposed_date ?? (row.current_start ? chicagoDateKey(row.current_start) : null);
  const timeHHMM = row.proposed_start_time ?? null;
  if (dayKey && timeHHMM) {
    const startUtc = new Date(`${dayKey}T${timeHHMM}:00${formatOffset(chicagoOffsetForDate(dayKey))}`);
    if (Number.isNaN(startUtc.getTime())) { await release(); return { ok: false, error: "invalid proposed date/time" }; }
    const sameStart = appt?.scheduled_start && Math.abs(new Date(appt.scheduled_start).getTime() - startUtc.getTime()) < 60_000;
    if (!sameStart) {
      let durMs = 120 * 60_000;
      if (appt?.scheduled_start && appt?.scheduled_end) {
        const d = new Date(appt.scheduled_end).getTime() - new Date(appt.scheduled_start).getTime();
        if (d > 0) durMs = d;
      }
      updateBody.scheduled_start = startUtc.toISOString();
      updateBody.scheduled_end = new Date(startUtc.getTime() + durMs).toISOString();
    }
  }

  // Reassign — resolve proposed_tech (hcp_full_name) -> hcp_employee_id (pro_...).
  // Tolerant match (trim + case-insensitive) so display-name drift doesn't fail
  // closed silently; still errors out (no bad write) if truly unresolvable.
  if (row.kind === "reassign" && row.proposed_tech) {
    const name = String(row.proposed_tech).trim();
    const { data: tech } = await supa
      .from("tech_directory")
      .select("hcp_employee_id")
      .ilike("hcp_full_name", name)
      .eq("is_active", true)
      .not("hcp_employee_id", "is", null)
      .maybeSingle();
    if (!tech?.hcp_employee_id) { await release(); return { ok: false, error: `no active HCP employee for "${row.proposed_tech}"` }; }
    updateBody.assigned_employee_ids = [tech.hcp_employee_id];
  }

  if (!updateBody.scheduled_start && !updateBody.assigned_employee_ids) {
    await release();
    return { ok: false, error: "nothing to apply — proposal matches the current slot/tech" };
  }

  // Push to HCP.
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/update-hcp-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(updateBody),
    });
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !json?.ok) {
      await release();
      const status = (json?.status as number) ?? res.status;
      const hint = status === 404 || status === 405
        ? " — HCP REST rejected the schedule/assignee update; the browser-bot path is needed for this field."
        : "";
      return { ok: false, error: (String(json?.error ?? `update-hcp-job ${res.status}`)) + hint };
    }
  } catch (e) {
    await release();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // HCP changed. Mark applied — and if THAT fails, leave the row 'applying'
  // (never re-pending) and log the divergence loudly so it can't double-fire.
  const { error: markErr } = await supa
    .from("schedule_change_requests")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", id);
  if (markErr) {
    try {
      await supa.from("maintenance_logs").insert({
        source: "applyChangeRequest", level: "error",
        message: "HCP updated but proposal not marked applied — divergence, do NOT re-apply",
        context: { id, hcp_job_id: hcpJobId, error: markErr.message },
      });
    } catch { /* best-effort */ }
  }

  // Bounce HCP state back, widened to cover the proposed day. The sync fn reads
  // its window from the URL query (start/end), NOT the body, so pass it there.
  try {
    const startSync = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const proposedMs = dayKey ? new Date(`${dayKey}T12:00:00Z`).getTime() : Date.now();
    const endSync = new Date(Math.max(Date.now(), proposedMs) + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await fetch(`${SUPABASE_URL}/functions/v1/hcp-sync-appointments?start=${startSync}&end=${endSync}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    });
  } catch { /* cron catches up within 30 min */ }
  revalidatePath("/schedule");
  revalidatePath("/dispatch");
  revalidatePath("/me");
  return { ok: true };
}

// Chicago wall-clock -> UTC helpers (mirror app/dispatch/new-job/actions.ts;
// pure DST math, kept local so the booking flow isn't touched).
function chicagoDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD
}
function chicagoOffsetForDate(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return -6;
  const second = nthSunday(y, 3, 2);
  const firstNov = nthSunday(y, 11, 1);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day >= second && day < firstNov ? -5 : -6;
}
function nthSunday(year: number, month1: number, n: number): Date {
  const d = new Date(Date.UTC(year, month1 - 1, 1));
  const off = (7 - d.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month1 - 1, 1 + off + 7 * (n - 1)));
}
function formatOffset(hours: number): string {
  const sign = hours >= 0 ? "+" : "-";
  const abs = Math.abs(hours);
  return `${sign}${String(Math.floor(abs)).padStart(2, "0")}:00`;
}
