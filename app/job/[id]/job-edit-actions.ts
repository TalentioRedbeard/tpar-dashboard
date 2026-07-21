"use server";

// Job-basics editing for admin/management (Danny 2026-07-21, Q1 = schedule/tech).
// Reschedule (date/time) + reassign the tech from a typed panel on /job — the same
// write-through the /schedule drag uses (update-hcp-job), for when typing beats
// dragging. Gated admin|manager; techs stay read-only. NOTE: job NOTES in HCP are
// append-only note entries (not a single editable field), so notes editing is a
// separate follow-on — this covers the schedule + assignee fields.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type AssignableTech = { hcp_employee_id: string; hcp_full_name: string; tech_short_name: string };

// Active, non-test techs with an HCP employee id — the reassign picker (leadership only).
export async function getAssignableTechs(): Promise<AssignableTech[]> {
  const me = await getCurrentTech().catch(() => null);
  if (!(me?.isAdmin || me?.isManager)) return [];
  const { data } = await db()
    .from("tech_directory")
    .select("hcp_employee_id, hcp_full_name, tech_short_name, is_active, is_test")
    .eq("is_active", true)
    .not("hcp_employee_id", "is", null)
    .order("tech_short_name", { ascending: true });
  return (data ?? [])
    .filter((t) => !(t as { is_test?: boolean }).is_test && (t as { hcp_employee_id?: string }).hcp_employee_id)
    .map((t) => ({
      hcp_employee_id: (t as { hcp_employee_id: string }).hcp_employee_id,
      hcp_full_name: (t as { hcp_full_name: string }).hcp_full_name,
      tech_short_name: (t as { tech_short_name: string }).tech_short_name,
    }));
}

export async function editJobBasics(input: {
  hcp_job_id: string;
  scheduled_start?: string; // ISO UTC — reschedule
  scheduled_end?: string;   // ISO UTC
  assigned_employee_id?: string | null; // reassign
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!(me?.isAdmin || me?.isManager)) return { ok: false, error: "Only managers or admins can edit jobs." };
  if (!input.hcp_job_id) return { ok: false, error: "Missing job." };
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { ok: false, error: "Server isn't configured to write to HCP." };

  const wantSchedule = !!(input.scheduled_start && input.scheduled_end);
  const wantAssignee = !!input.assigned_employee_id;
  if (!wantSchedule && !wantAssignee) return { ok: true };

  // Multi-visit guard — update-hcp-job reschedules the whole JOB; on a multi-visit
  // job that would move every visit. Refuse a reschedule (reassign is still fine).
  if (wantSchedule) {
    const { count } = await db()
      .from("appointments_master")
      .select("id", { count: "exact", head: true })
      .eq("hcp_job_id", input.hcp_job_id)
      .is("deleted_at", null);
    if ((count ?? 0) > 1) {
      return { ok: false, error: "Multi-visit job — reschedule it in HCP for now (per-visit editing is coming)." };
    }
  }

  const body: Record<string, unknown> = {
    hcp_job_id: input.hcp_job_id,
    notify_customer: false, // a silent edit must never text the customer
    reason: `job edit (schedule/assignee) by ${me.email}`,
  };
  if (wantSchedule) { body.scheduled_start = input.scheduled_start; body.scheduled_end = input.scheduled_end; }
  if (wantAssignee) body.assigned_employee_ids = [input.assigned_employee_id];

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/update-hcp-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the HCP update service: ${e instanceof Error ? e.message : String(e)}` };
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j?.ok) return { ok: false, error: j?.error ?? `HCP job update failed (${res.status}).` };

  // Bounce the appointment sync so /job + /schedule reflect the change promptly.
  try {
    const startSync = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const endSync = new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await fetch(`${SUPABASE_URL}/functions/v1/hcp-sync-appointments?start=${startSync}&end=${endSync}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
    });
  } catch { /* cron catches up */ }

  revalidatePath(`/job/${input.hcp_job_id}`);
  revalidatePath("/schedule");
  return { ok: true };
}
