"use server";

// Mark an appointment "handled" on the current tech's /me dashboard, WITHOUT
// firing any HCP lifecycle trigger. Restore by deleting the row. Scoped to the
// signed-in tech only — others viewing the dashboard still see the row.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export async function dismissAppointment(input: {
  appointmentId?: string | null;
  hcpJobId?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  const techEmail = me?.tech?.email ?? me?.email ?? null;
  if (!techEmail) return { ok: false, error: "not signed in" };
  const apptId = input.appointmentId?.trim() || null;
  const jobId = input.hcpJobId?.trim() || null;
  if (!apptId && !jobId) return { ok: false, error: "appointment_id or hcp_job_id required" };

  const row: Record<string, unknown> = {
    tech_email: techEmail.toLowerCase(),
    appointment_id: apptId,
    hcp_job_id: jobId,
    note: input.note?.trim() || null,
  };
  // Upsert keyed on whichever id is present; ignore conflict.
  const onConflict = apptId ? "tech_email,appointment_id" : "tech_email,hcp_job_id";
  const { error } = await db().from("tech_appointment_dismissals").upsert(row, {
    onConflict,
    ignoreDuplicates: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/me");
  return { ok: true };
}

export async function restoreAppointment(input: {
  appointmentId?: string | null;
  hcpJobId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  const techEmail = me?.tech?.email ?? me?.email ?? null;
  if (!techEmail) return { ok: false, error: "not signed in" };
  const apptId = input.appointmentId?.trim() || null;
  const jobId = input.hcpJobId?.trim() || null;
  if (!apptId && !jobId) return { ok: false, error: "id required" };

  let query = db().from("tech_appointment_dismissals").delete()
    .eq("tech_email", techEmail.toLowerCase());
  query = apptId ? query.eq("appointment_id", apptId) : query.eq("hcp_job_id", jobId!);
  const { error } = await query;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/me");
  return { ok: true };
}
