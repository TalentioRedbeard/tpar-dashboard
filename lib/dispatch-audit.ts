"use server";

// Best-effort attribution log for dispatch write-actions (apply a schedule
// change, create a job, ...). Records WHO did it for analytics. Never throws —
// a failed audit insert must not block the underlying action.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";

export async function logDispatchAction(input: {
  action: string;                          // 'reschedule' | 'reassign' | 'create_job'
  hcp_job_id?: string | null;
  appointment_id?: string | null;
  change_request_id?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const me = await getCurrentTech();
    const role = !me ? null
      : isOwner(me.email) ? "owner"
      : me.isAdmin ? "admin"
      : me.isManager ? "manager"
      : "other";
    await db().from("dispatch_audit").insert({
      action: input.action,
      actor_short_name: me?.tech?.tech_short_name ?? null,
      actor_email: me?.email ?? null,
      actor_role: role,
      hcp_job_id: input.hcp_job_id ?? null,
      appointment_id: input.appointment_id ?? null,
      change_request_id: input.change_request_id ?? null,
      detail: input.detail ?? {},
    });
  } catch { /* analytics logging never blocks the action */ }
}
