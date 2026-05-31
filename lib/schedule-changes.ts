"use server";

// Schedule change requests (#21 front-end). Queue a reschedule proposal from the
// /schedule UI — TPAR-side only; the HCP write is gated on the bot endpoint, so
// these are pending proposals the dispatcher reviews. Admin/manager gated.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

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
