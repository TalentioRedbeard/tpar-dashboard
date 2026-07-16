"use server";

// B2 (2026-07-16): one-tap ack/decline on wrap-sourced schedule requests.
// These tasks are auto-created by tech-wrap-distill (ref_kind =
// 'wrap_schedule_request', assigned to the scheduler) — the deliberate,
// scoped exception to "nothing auto-assigns": a time-off ask that rots in a
// review queue is a no-show. Ack = honored (done); decline = canceled with a
// required why. Both audit to task_events. NOTHING here texts anyone — the
// human closes the loop with the tech.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { requireManagement } from "@/lib/current-tech";

export type ScheduleRequestDecision =
  | { ok: true }
  | { ok: false; error: string };

export async function decideScheduleRequest(input: {
  taskId: string;
  decision: "ack" | "decline";
  note?: string;
}): Promise<ScheduleRequestDecision> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };

  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return { ok: false, error: "Missing task id." };
  const note = input.note?.trim() || null;
  if (input.decision === "decline" && !note) {
    return { ok: false, error: "Say why it's declined — the tech hears back from you, and the why matters." };
  }

  const supa = db();
  // Only rows this action owns: wrap schedule requests still open.
  const { data: task } = await supa
    .from("tasks")
    .select("id, status, ref_kind")
    .eq("id", taskId)
    .eq("ref_kind", "wrap_schedule_request")
    .maybeSingle();
  if (!task) return { ok: false, error: "Not a schedule request (or it's gone)." };
  if (task.status === "done" || task.status === "canceled") {
    return { ok: false, error: "Already decided." };
  }

  const status = input.decision === "ack" ? "done" : "canceled";
  const { error: uErr } = await supa.from("tasks").update({ status }).eq("id", taskId);
  if (uErr) return { ok: false, error: uErr.message };

  await supa.from("task_events").insert({
    task_id: taskId,
    event: input.decision === "ack" ? "schedule_request_acked" : "schedule_request_declined",
    actor: gate.email,
    detail: note ? { note } : {},
  }).then(() => {}, () => {});

  revalidatePath("/manage");
  return { ok: true };
}
