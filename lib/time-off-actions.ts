"use server";

// Time-off requests (Danny 2026-07-17). ANY role can request time off from the
// schedule; the office approves/declines via /manage (the existing schedule-request
// queue, extended); on approval the day shows an "Off — Name" band on the board.
// Not PTO accounting — request + status + inclusive date range. Server-role writes.

import { db } from "@/lib/supabase";
import { getCurrentTech, requireManagement } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type TimeOffRow = {
  id: string;
  hcp_employee_id: string | null;
  tech_full_name: string;
  tech_short_name: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  requested_by: string | null;
  requested_role: string | null;
  created_at: string;
};
type Res = { ok: boolean; error?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function roleOf(me: Awaited<ReturnType<typeof getCurrentTech>>): string {
  if (!me) return "unknown";
  if (me.isAdmin) return "admin";
  if (me.isManager) return "manager";
  if (me.tech) return "tech";
  return "office";
}

// Anyone signed in may request time off (for themselves). Techs' requests render
// a board band on approval (matched by hcp_full_name); office-without-a-tech-row
// still files a tracked request (no board lane to band).
export async function requestTimeOff(input: {
  start_date: string;
  end_date?: string;
  reason?: string;
}): Promise<Res> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "sign in required" };
  const start = String(input.start_date ?? "").trim();
  const end = String(input.end_date ?? start).trim() || start;
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return { ok: false, error: "pick a valid date" };
  if (end < start) return { ok: false, error: "end date is before start date" };

  const supa = db();
  const { error } = await supa.from("time_off_requests").insert({
    hcp_employee_id: me.tech?.hcp_employee_id ?? null,
    tech_full_name: me.tech?.hcp_full_name ?? me.realEmail ?? me.email,
    tech_short_name: me.tech?.tech_short_name ?? null,
    start_date: start,
    end_date: end,
    reason: input.reason?.trim() || null,
    status: "pending",
    requested_by: me.tech?.tech_short_name ?? me.email,
    requested_role: roleOf(me),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schedule");
  revalidatePath("/dispatch");
  revalidatePath("/manage");
  revalidatePath("/me");
  return { ok: true };
}

// The requester may cancel their OWN still-pending request.
export async function cancelMyTimeOff(id: string): Promise<Res> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "sign in required" };
  const who = me.tech?.tech_short_name ?? me.email;
  const supa = db();
  const { error } = await supa
    .from("time_off_requests")
    .delete()
    .eq("id", id)
    .eq("status", "pending")
    .eq("requested_by", who);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schedule");
  revalidatePath("/me");
  return { ok: true };
}

// Office view of pending requests (the /manage approval queue).
export async function listPendingTimeOff(): Promise<TimeOffRow[]> {
  const gate = await requireManagement();
  if (!gate.ok) return [];
  const supa = db();
  const { data } = await supa
    .from("time_off_requests")
    .select("id, hcp_employee_id, tech_full_name, tech_short_name, start_date, end_date, reason, status, requested_by, requested_role, created_at")
    .eq("status", "pending")
    .order("start_date", { ascending: true });
  return (data ?? []) as TimeOffRow[];
}

// Approved time-off overlapping a date window — for the board bands. Any signed-in
// board viewer may read it (who's off is schedule info, not revenue).
export async function listApprovedTimeOff(startKey: string, endKey: string): Promise<TimeOffRow[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const supa = db();
  const { data } = await supa
    .from("time_off_requests")
    .select("id, hcp_employee_id, tech_full_name, tech_short_name, start_date, end_date, reason, status, requested_by, requested_role, created_at")
    .eq("status", "approved")
    .lte("start_date", endKey)
    .gte("end_date", startKey);
  return (data ?? []) as TimeOffRow[];
}

// Office approves/declines. Decline requires a why (the tech hears back).
export async function decideTimeOff(input: {
  id: string;
  decision: "approve" | "decline";
  note?: string;
}): Promise<Res> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };
  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, error: "missing id" };
  const note = input.note?.trim() || null;
  if (input.decision === "decline" && !note) {
    return { ok: false, error: "Say why it's declined — the person hears back from you." };
  }
  const supa = db();
  const { data: row } = await supa.from("time_off_requests").select("id, status").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not found (or already gone)" };
  if (row.status !== "pending") return { ok: false, error: "already decided" };

  const { error } = await supa
    .from("time_off_requests")
    .update({
      status: input.decision === "approve" ? "approved" : "declined",
      decided_by: gate.email,
      decided_at: new Date().toISOString(),
      decide_note: note,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/manage");
  revalidatePath("/schedule");
  revalidatePath("/dispatch");
  revalidatePath("/me");
  return { ok: true };
}
