"use server";

// Server actions for the lifecycle-trigger forms on /job/[id].
// Each action fires the corresponding trigger via fire-trigger edge fn,
// passing the form payload as context. The trigger registry handles
// dispatch + audit.
//
// Per Danny 2026-05-04: "post-presentation and eoj forms should have push
// buttons for forms. Those 7 should be next."
//
// v0 scope: triggers #5 / #6 / #7. #2 (On My Way) folded in for completeness.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type TriggerResult =
  | { ok: true; event_id: string }
  | { ok: false; error: string };

interface FireTriggerArgs {
  trigger_number: 2 | 5 | 6 | 7;
  hcp_job_id: string;
  hcp_customer_id?: string | null;
  appointment_id?: string | null;
  context: Record<string, unknown>;
}

async function fireJobTrigger(args: FireTriggerArgs): Promise<TriggerResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };

  const supabase = db();

  // Idempotency: prevent duplicate fires of the same trigger for the same
  // job within a short window (e.g., double-tap). Use trigger#:job pair as
  // the dedup key with a per-day grain so each day's lifecycle can re-fire
  // if needed (rare; covers same-customer-same-day repeat).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const idempotencyKey = `trigger:${args.trigger_number}:${args.hcp_job_id}:${today}`;

  const TRIGGER_NAMES: Record<number, string> = {
    2: "on_my_way_call_customer",
    5: "present_post_presentation",
    6: "finish_work",
    7: "collect_finish_done",
  };

  // Direct insert (skipping the fire-trigger HTTP roundtrip for now —
  // simpler + faster; the registry can later subscribe to this table).
  const { data: row, error: insErr } = await supabase
    .from("job_lifecycle_events")
    .insert({
      trigger_number: args.trigger_number,
      trigger_name:   TRIGGER_NAMES[args.trigger_number],
      hcp_job_id:     args.hcp_job_id,
      hcp_customer_id: args.hcp_customer_id ?? null,
      appointment_id: args.appointment_id ?? null,
      fired_by:       me.tech?.tech_short_name ?? me.email,
      origin:         "dashboard",
      context:        { ...args.context, dashboard_user_email: me.email },
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (insErr) {
    // Idempotency hit (unique violation) — look up the existing event
    if (insErr.message.toLowerCase().includes("uq_jle_idempotency_key")) {
      const { data: existing } = await supabase
        .from("job_lifecycle_events")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing?.id) {
        revalidatePath(`/job/${args.hcp_job_id}`);
        return { ok: true, event_id: existing.id as string };
      }
    }
    return { ok: false, error: insErr.message };
  }

  revalidatePath(`/job/${args.hcp_job_id}`);
  return { ok: true, event_id: (row?.id as string) ?? "" };
}

// ─── Trigger #2 — On My Way ──────────────────────────────────────────────
export async function fireOnMyWay(input: {
  hcp_job_id: string;
  hcp_customer_id?: string | null;
  appointment_id?: string | null;
  customer_called: boolean;
  notes?: string;
}): Promise<TriggerResult> {
  return fireJobTrigger({
    trigger_number: 2,
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id,
    appointment_id: input.appointment_id,
    context: {
      customer_called: input.customer_called,
      notes: input.notes ?? null,
    },
  });
}

// ─── Trigger #5 — Present (post-presentation) ────────────────────────────
export type CustomerDisposition =
  | "approved_now"
  | "approved_financing"
  | "thinking"
  | "declined"
  | "partial";

export async function firePresent(input: {
  hcp_job_id: string;
  hcp_customer_id?: string | null;
  options_presented_count?: number;       // how many options shown
  options_presented_descriptions?: string;
  customer_disposition: CustomerDisposition;
  followup_date?: string;                  // ISO date if "thinking"
  notes?: string;
}): Promise<TriggerResult> {
  return fireJobTrigger({
    trigger_number: 5,
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id,
    context: {
      options_presented_count: input.options_presented_count ?? null,
      options_presented_descriptions: input.options_presented_descriptions ?? null,
      customer_disposition: input.customer_disposition,
      followup_date: input.followup_date ?? null,
      notes: input.notes ?? null,
    },
  });
}

// ─── Trigger #6 — Finish work ────────────────────────────────────────────
export async function fireFinishWork(input: {
  hcp_job_id: string;
  hcp_customer_id?: string | null;
  final_photos_done: boolean;
  area_cleaned: boolean;
  notes?: string;
}): Promise<TriggerResult> {
  return fireJobTrigger({
    trigger_number: 6,
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id,
    context: {
      final_photos_done: input.final_photos_done,
      area_cleaned: input.area_cleaned,
      notes: input.notes ?? null,
    },
  });
}

// ─── Trigger #7 — Collect + Done ────────────────────────────────────────
export type PaymentMethod = "cash" | "card" | "check" | "financing" | "not_yet" | "other";

export async function fireCollectDone(input: {
  hcp_job_id: string;
  hcp_customer_id?: string | null;
  payment_method: PaymentMethod;
  amount_collected_dollars?: number;        // 0 = no payment
  customer_satisfied: boolean;
  request_review: boolean;
  notes?: string;
}): Promise<TriggerResult> {
  return fireJobTrigger({
    trigger_number: 7,
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id,
    context: {
      payment_method: input.payment_method,
      amount_collected_dollars: input.amount_collected_dollars ?? null,
      customer_satisfied: input.customer_satisfied,
      request_review: input.request_review,
      notes: input.notes ?? null,
    },
  });
}

// ─── Read: which triggers have already fired for this job ───────────────
export type FiredTrigger = {
  id: string;
  trigger_number: number;
  trigger_name: string;
  fired_by: string | null;
  fired_at: string;
  context: Record<string, unknown>;
};

export async function getFiredTriggersForJob(hcp_job_id: string): Promise<FiredTrigger[]> {
  const supabase = db();
  const { data } = await supabase
    .from("job_lifecycle_events")
    .select("id, trigger_number, trigger_name, fired_by, fired_at, context")
    .eq("hcp_job_id", hcp_job_id)
    .order("fired_at", { ascending: true });
  return (data ?? []) as FiredTrigger[];
}
