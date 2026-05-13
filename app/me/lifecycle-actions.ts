"use server";

// Server actions for firing the 7 canonical job lifecycle triggers from /me.
// Writes directly to job_lifecycle_events via service role (bypassing the
// fire-trigger edge fn for now — handlers can be wired in later).
//
// Trigger numbers (per docs/JOB_LIFECYCLE_TRIGGERS.md):
//   1 = procuring_call_text_web
//   2 = on_my_way_call_customer         → fire HCP "On my way" (customer SMS)
//   3 = press_start_before_van          → fire HCP "Start"     (internal)
//   4 = build_estimate_with_options
//   5 = present_post_presentation
//   6 = finish_work                     → fire HCP "Finish"    (internal)
//   7 = collect_finish_done             → TPAR-only, no HCP action
//
// HCP mirror: after the TPAR-side event is recorded, we fire-and-forget a
// call to hcp-trigger-action which drives HCP's UI via tpar-hcp-bot. The
// TPAR record is the source of truth; the HCP push is a courtesy mirror so
// the customer-facing surface (notifications, invoicing, time-tracking) stays
// in sync. If the bot fails, the TPAR record still stands and we can backfill.
// Per project_visibility_notification_decoupling_2026-05-12.md, OMW is the
// only customer-notifying trigger — Start/Finish are internal mirrors only.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const TRIGGER_NAMES: Record<number, string> = {
  1: "procuring_call_text_web",
  2: "on_my_way_call_customer",
  3: "press_start_before_van",
  4: "build_estimate_with_options",
  5: "present_post_presentation",
  6: "finish_work",
  7: "collect_finish_done",
};

// Trigger → HCP action mapping. Triggers not listed (1, 4, 5, 7) don't mirror
// to HCP — they're either TPAR-only concepts or covered by other paths.
const TRIGGER_TO_HCP_ACTION: Record<number, "on_my_way" | "start" | "finish" | undefined> = {
  1: undefined,
  2: "on_my_way",
  3: "start",
  4: undefined,
  5: undefined,
  6: "finish",
  7: undefined,
};

// Fire-and-forget HCP mirror. Returns immediately; the bot call happens in
// the background (it takes ~2:30 for Playwright to launch, navigate, click,
// confirm, and verify). Failures log to maintenance_logs but don't propagate
// back to the caller — TPAR's lifecycle event is the source of truth.
function fireHcpMirrorInBackground(
  hcpJobId: string,
  hcpAction: "on_my_way" | "start" | "finish",
  techShortName: string,
  triggerNumber: number,
): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    void db().from("maintenance_logs").insert({
      source: "lifecycle-hcp-mirror", level: "warn",
      message: "skipped HCP mirror: server config missing",
      context: { hcp_job_id: hcpJobId, action: hcpAction, trigger_number: triggerNumber, tech: techShortName },
    });
    return;
  }
  const t0 = Date.now();
  // Intentionally not awaited.
  void (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hcp-trigger-action`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id: hcpJobId, action: hcpAction }),
      });
      const text = await res.text();
      await db().from("maintenance_logs").insert({
        source: "lifecycle-hcp-mirror",
        level: res.ok ? "info" : "error",
        message: res.ok ? "HCP mirror fired" : `HCP mirror failed: ${res.status}`,
        context: {
          hcp_job_id: hcpJobId,
          action: hcpAction,
          trigger_number: triggerNumber,
          tech: techShortName,
          http_status: res.status,
          elapsed_ms: Date.now() - t0,
          response: text.slice(0, 800),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db().from("maintenance_logs").insert({
        source: "lifecycle-hcp-mirror", level: "error",
        message: `HCP mirror threw: ${msg}`,
        context: {
          hcp_job_id: hcpJobId,
          action: hcpAction,
          trigger_number: triggerNumber,
          tech: techShortName,
          elapsed_ms: Date.now() - t0,
        },
      });
    }
  })();
}

export type FireResult = { ok: true; event_id: string; fired_at: string } | { ok: false; error: string };

export type HcpMirrorStatus = {
  state: "pending" | "synced" | "failed" | "not_applicable" | "unknown";
  message?: string;
  bot_status?: number;
  elapsed_ms?: number;
};

/**
 * Look up the HCP-mirror outcome for a recently-fired lifecycle trigger.
 * Returns 'pending' until the bot finishes (~2:30 typical) and the
 * hcp-trigger-action edge fn writes its outcome to maintenance_logs.
 *
 * Called by LifecycleButtons via polling after a fire.
 */
export async function getLifecycleHcpStatus(input: {
  hcp_job_id: string;
  trigger_number: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  fired_after: string;
}): Promise<HcpMirrorStatus> {
  const me = await getCurrentTech();
  if (!me?.tech) return { state: "unknown", message: "Not signed in." };

  const hcpAction = TRIGGER_TO_HCP_ACTION[input.trigger_number];
  if (!hcpAction) return { state: "not_applicable" };

  const supa = db();
  const { data, error } = await supa
    .from("maintenance_logs")
    .select("ts,level,message,context")
    .eq("source", "hcp-trigger-action")
    .gte("ts", input.fired_after)
    .order("ts", { ascending: false })
    .limit(20);

  if (error) return { state: "unknown", message: error.message };
  if (!data || data.length === 0) return { state: "pending" };

  // Find the row matching this job + action (the same edge fn invocation
  // can fire for many job+action pairs; we want OUR ONE).
  const match = data.find((row) => {
    const ctx = (row.context ?? {}) as Record<string, unknown>;
    return ctx.job_id === input.hcp_job_id && ctx.action === hcpAction;
  });
  if (!match) return { state: "pending" };

  const ctx = (match.context ?? {}) as Record<string, unknown>;
  const botStatus = typeof ctx.bot_status === "number" ? (ctx.bot_status as number) : undefined;
  const elapsedMs = typeof ctx.elapsed_ms === "number" ? (ctx.elapsed_ms as number) : undefined;
  const botResponse = ctx.bot_response as { success?: boolean; error?: string } | undefined;

  if (match.level === "error" || botResponse?.success === false) {
    return {
      state: "failed",
      message: botResponse?.error?.slice(0, 200) ?? (match.message as string | undefined) ?? "bot failed",
      bot_status: botStatus,
      elapsed_ms: elapsedMs,
    };
  }

  return {
    state: "synced",
    message: typeof match.message === "string" ? match.message : undefined,
    bot_status: botStatus,
    elapsed_ms: elapsedMs,
  };
}

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

  // Capture an ISO timestamp BEFORE firing the HCP mirror so the client can
  // poll maintenance_logs with `ts >= fired_at` and find this trigger's
  // outcome cleanly. Small skew (the insert already happened a moment ago)
  // is fine — the bot's log row will be strictly after.
  const firedAt = new Date().toISOString();

  // Fire-and-forget HCP mirror for triggers that have an HCP counterpart.
  // Awaiting this would block the tech for ~2:30 (Playwright launch + navigate
  // + two-click sequence + verify). The bot result lands in maintenance_logs.
  const hcpAction = TRIGGER_TO_HCP_ACTION[input.trigger_number];
  if (hcpAction) {
    fireHcpMirrorInBackground(input.hcp_job_id, hcpAction, me.tech.tech_short_name, input.trigger_number);
  }

  revalidatePath("/me");
  revalidatePath(`/job/${input.hcp_job_id}`);

  return { ok: true, event_id: data.id as string, fired_at: firedAt };
}
