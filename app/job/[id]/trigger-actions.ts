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
import { after } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// FLAG (default OFF): push a /job trigger press to HCP (mirror OMW/Start/Finish via the
// bot). The /me path already mirrors these, so this is enabled deliberately — set
// JOB_TRIGGER_HCP_PUSH_ENABLED=true in Vercel env, then REDEPLOY/restart (read at module
// load, NOT per request — flipping the env var alone won't take effect). (Danny 2026-06-15.)
// Enable-time watch-list: the /me path has no dedup (a /me fire AFTER a /job fire can still
// double-drive the bot — bot is idempotent, low blast radius); canary on 2-3 techs + watch
// maintenance_logs source='job-trigger-hcp-mirror' for dup (job_id,action) within 30 min.
const JOB_TRIGGER_HCP_PUSH_ENABLED = process.env.JOB_TRIGGER_HCP_PUSH_ENABLED === "true";

// Only these triggers have an HCP counterpart the bot can drive (matches the /me map).
const JOB_TRIGGER_TO_HCP_ACTION: Record<number, "on_my_way" | "start" | "finish" | undefined> = {
  2: "on_my_way",
  3: "start",
  6: "finish",
};

// Fire-and-forget HCP mirror for a /job trigger press. Deliberately replicates the /me
// path's helper (app/me/lifecycle-actions.ts::fireHcpMirrorInBackground) so the proven
// /me mirror stays untouched. Posts to hcp-trigger-action; logs the outcome to
// maintenance_logs (source 'job-trigger-hcp-mirror'). Never awaited by the caller.
function fireJobHcpMirror(
  hcpJobId: string,
  action: "on_my_way" | "start" | "finish",
  actor: string,
  triggerNumber: number,
): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const t0 = Date.now();
  // Deferred via after() (not a bare promise) so Vercel doesn't drop the dispatch
  // when the instance freezes post-revalidate — see lifecycle-actions.ts.
  after(async () => {
    const supa = db();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hcp-trigger-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: hcpJobId, action }),
      });
      const text = await res.text();
      await supa.from("maintenance_logs").insert({
        source: "job-trigger-hcp-mirror",
        level: res.ok ? "info" : "error",
        message: res.ok ? "HCP mirror fired from /job" : `HCP mirror failed: ${res.status}`,
        context: { hcp_job_id: hcpJobId, job_id: hcpJobId, action, trigger_number: triggerNumber, actor, http_status: res.status, elapsed_ms: Date.now() - t0, response: text.slice(0, 800) },
      });
    } catch (e) {
      await supa.from("maintenance_logs").insert({
        source: "job-trigger-hcp-mirror", level: "error",
        message: `HCP mirror threw: ${e instanceof Error ? e.message : String(e)}`,
        context: { hcp_job_id: hcpJobId, job_id: hcpJobId, action, trigger_number: triggerNumber, actor, elapsed_ms: Date.now() - t0 },
      });
    }
  });
}

// Decide whether to push this freshly-fired /job trigger to HCP. Gated by the flag,
// limited to OMW/Start/Finish, and skipped if the SAME trigger fired for this job in the
// last 30 min (the /me GPS/button path, or a rapid re-press) so the bot isn't double-driven.
async function maybeMirrorJobTriggerToHcp(
  triggerNumber: number,
  hcpJobId: string,
  actor: string,
  newEventId: string,
  supabase: ReturnType<typeof db>,
): Promise<void> {
  if (!JOB_TRIGGER_HCP_PUSH_ENABLED) return;
  const action = JOB_TRIGGER_TO_HCP_ACTION[triggerNumber];
  if (!action) return;

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("job_lifecycle_events")
    .select("id", { count: "exact", head: true })
    .eq("hcp_job_id", hcpJobId)
    .eq("trigger_number", triggerNumber)
    .gte("fired_at", since)
    .neq("id", newEventId);
  if ((count ?? 0) > 0) {
    void supabase.from("maintenance_logs").insert({
      source: "job-trigger-hcp-mirror", level: "info",
      message: "skipped HCP mirror: same trigger fired for this job in the last 30 min",
      context: { hcp_job_id: hcpJobId, action, trigger_number: triggerNumber, actor },
    });
    return;
  }
  fireJobHcpMirror(hcpJobId, action, actor, triggerNumber);
}

export type TriggerResult =
  | { ok: true; event_id: string }
  | { ok: false; error: string };

interface FireTriggerArgs {
  trigger_number: 2 | 3 | 5 | 6 | 7 | 8 | 9;
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
    3: "press_start_before_van",
    5: "present_post_presentation",
    6: "finish_work",
    7: "collect_finish_done",
    8: "schedule",
    9: "perform_work",
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

  // Fresh insert only (idempotency hits returned above) — push to HCP behind the flag,
  // deduped vs the /me path. Mirrors OMW/Start/Finish; no-op for the others.
  await maybeMirrorJobTriggerToHcp(
    args.trigger_number,
    args.hcp_job_id,
    me.tech?.tech_short_name ?? me.email,
    row?.id as string,
    supabase,
  );

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

// ─── Light, log-only triggers (Job 360 bar) ─────────────────────────────
// #8 Schedule, #3 Start, #9 Perform Work — one-tap logs with an optional note.
// These are TPAR-only timeline markers on the job page; they do NOT mirror to
// HCP or auto-fire GPS (those stay on the /me path for #2/#3/#6).
export async function fireSchedule(input: {
  hcp_job_id: string; hcp_customer_id?: string | null; notes?: string;
}): Promise<TriggerResult> {
  return fireJobTrigger({
    trigger_number: 8,
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id,
    context: { notes: input.notes ?? null },
  });
}

export async function fireStart(input: {
  hcp_job_id: string; hcp_customer_id?: string | null; notes?: string;
}): Promise<TriggerResult> {
  return fireJobTrigger({
    trigger_number: 3,
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id,
    context: { notes: input.notes ?? null },
  });
}

export async function firePerformWork(input: {
  hcp_job_id: string; hcp_customer_id?: string | null; notes?: string;
}): Promise<TriggerResult> {
  return fireJobTrigger({
    trigger_number: 9,
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id,
    context: { notes: input.notes ?? null },
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
  origin: string | null; // 'dashboard' | 'gps_confirmed' | 'hcp_derived' | …
  context: Record<string, unknown>;
};

export async function getFiredTriggersForJob(hcp_job_id: string): Promise<FiredTrigger[]> {
  const supabase = db();
  const { data } = await supabase
    .from("job_lifecycle_events")
    .select("id, trigger_number, trigger_name, fired_by, fired_at, origin, context")
    .eq("hcp_job_id", hcp_job_id)
    .order("fired_at", { ascending: true });
  return (data ?? []) as FiredTrigger[];
}
