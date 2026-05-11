"use server";

// Server actions for firing the 7 canonical job lifecycle triggers from /me.
// Writes directly to job_lifecycle_events via service role (bypassing the
// fire-trigger edge fn for now — handlers can be wired in later).
//
// Trigger numbers (per docs/JOB_LIFECYCLE_TRIGGERS.md):
//   1 = procuring_call_text_web
//   2 = on_my_way_call_customer
//   3 = press_start_before_van           (already covered by StartAppointmentButton)
//   4 = build_estimate_with_options
//   5 = present_post_presentation
//   6 = finish_work
//   7 = collect_finish_done

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const TRIGGER_NAMES: Record<number, string> = {
  1: "procuring_call_text_web",
  2: "on_my_way_call_customer",
  3: "press_start_before_van",
  4: "build_estimate_with_options",
  5: "present_post_presentation",
  6: "finish_work",
  7: "collect_finish_done",
};

export type FireResult = { ok: true; event_id: string } | { ok: false; error: string };

export async function fireLifecycleTrigger(input: {
  trigger_number: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  hcp_job_id: string;
  hcp_appointment_id?: string;
  hcp_customer_id?: string;
  context?: Record<string, unknown>;
}): Promise<FireResult> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "Not signed in as a tech." };

  const triggerName = TRIGGER_NAMES[input.trigger_number];
  if (!triggerName) return { ok: false, error: "Invalid trigger_number." };

  const supabase = db();
  const { data, error } = await supabase
    .from("job_lifecycle_events")
    .insert({
      trigger_number: input.trigger_number,
      trigger_name: triggerName,
      hcp_job_id: input.hcp_job_id,
      appointment_id: input.hcp_appointment_id ?? null,
      hcp_customer_id: input.hcp_customer_id ?? null,
      fired_by: me.tech.tech_short_name,
      origin: "dashboard",
      context: input.context ?? {},
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "insert failed" };
  }

  revalidatePath("/me");
  revalidatePath(`/job/${input.hcp_job_id}`);

  return { ok: true, event_id: data.id as string };
}
