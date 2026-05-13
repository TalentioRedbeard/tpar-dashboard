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

  // Fire-and-forget HCP mirror for triggers that have an HCP counterpart.
  // Awaiting this would block the tech for ~2:30 (Playwright launch + navigate
  // + two-click sequence + verify). The bot result lands in maintenance_logs.
  const hcpAction = TRIGGER_TO_HCP_ACTION[input.trigger_number];
  if (hcpAction) {
    fireHcpMirrorInBackground(input.hcp_job_id, hcpAction, me.tech.tech_short_name, input.trigger_number);
  }

  revalidatePath("/me");
  revalidatePath(`/job/${input.hcp_job_id}`);

  return { ok: true, event_id: data.id as string };
}
