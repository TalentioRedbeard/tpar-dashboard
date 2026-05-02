"use server";

// Server actions for the wake-up alarm admin surface.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type CancelResult =
  | { ok: true }
  | { ok: false; error: string };

export type CreateAlarmInput = {
  name: string;
  fire_at_local: string;          // datetime-local string in Chicago time
  requirement_level: "soft" | "medium" | "hard" | "critical" | "extreme";
  ring_interval_seconds?: number;
  hard_cap_minutes?: number;
  escalate_after_attempts?: number;
};

export type CreateAlarmResult =
  | { ok: true; alarm_id: string; fire_at_iso: string }
  | { ok: false; error: string };

const REQ_DEFAULTS: Record<CreateAlarmInput["requirement_level"], { concurrent: string[]; escalation: string[]; ring: number; cap: number; escalateAfter: number }> = {
  soft:     { concurrent: ["pushover-normal"],                       escalation: [],                                       ring: 300, cap: 30, escalateAfter: 999 },
  medium:   { concurrent: ["pushover-normal", "twilio-call"],        escalation: ["notify-danny"],                          ring: 180, cap: 30, escalateAfter: 5   },
  hard:     { concurrent: ["twilio-call"],                            escalation: ["notify-danny"],                          ring: 120, cap: 30, escalateAfter: 5   },
  critical: { concurrent: ["twilio-call", "pushover-emergency"],     escalation: ["notify-danny"],                          ring: 90,  cap: 30, escalateAfter: 5   },
  extreme:  { concurrent: ["twilio-call", "pushover-emergency"],     escalation: ["notify-danny", "sms-backup-contact"],   ring: 60,  cap: 30, escalateAfter: 3   },
};

export async function createAlarm(input: CreateAlarmInput): Promise<CreateAlarmResult> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) return { ok: false, error: "Admin only." };

  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Name required." };
  if (name.length > 120) return { ok: false, error: "Name too long (max 120 chars)." };

  if (!input.fire_at_local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.fire_at_local)) {
    return { ok: false, error: "Fire time required (datetime-local format)." };
  }

  // Interpret fire_at_local as Chicago time. The user typed "2026-05-03 07:00"
  // meaning 7am Central. We need an absolute timestamptz.
  // Strategy: append the Chicago offset based on the date (DST-aware).
  // Simplest reliable approach: build a Date in UTC from the wall-clock string,
  // then convert by computing Chicago's offset on that date.
  const wallClock = input.fire_at_local.length === 16 ? input.fire_at_local + ":00" : input.fire_at_local;
  const naiveAsUtc = new Date(wallClock + "Z");
  // Compute Chicago offset by looking at how en-US renders that instant in Chicago vs. UTC
  const chicagoFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = chicagoFmt.formatToParts(naiveAsUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const chicagoStr = `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}:${get("second")}Z`;
  const offsetMs = naiveAsUtc.getTime() - new Date(chicagoStr).getTime();
  const fireAtUtc = new Date(naiveAsUtc.getTime() + offsetMs);

  if (fireAtUtc.getTime() < Date.now() - 60_000) {
    return { ok: false, error: "Fire time is in the past." };
  }
  if (fireAtUtc.getTime() > Date.now() + 365 * 24 * 60 * 60_000) {
    return { ok: false, error: "Fire time is more than a year away." };
  }

  const def = REQ_DEFAULTS[input.requirement_level];
  if (!def) return { ok: false, error: "Invalid requirement level." };

  const supabase = db();
  const { data, error } = await supabase
    .from("wake_up_alarms")
    .insert({
      name,
      fire_at: fireAtUtc.toISOString(),
      requirement_level: input.requirement_level,
      concurrent_channels: def.concurrent,
      escalation_channels: def.escalation,
      ring_interval_seconds: input.ring_interval_seconds ?? def.ring,
      hard_cap_minutes: input.hard_cap_minutes ?? def.cap,
      escalate_after_attempts: input.escalate_after_attempts ?? def.escalateAfter,
      escalate_action: def.escalation.length > 0 ? def.escalation[0] : "none",
      source_program: "tpar-dashboard",
      source_function: "manual-create",
      created_by: me.email,
    })
    .select("id, fire_at")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };

  revalidatePath("/alarms");
  return { ok: true, alarm_id: data.id as string, fire_at_iso: data.fire_at as string };
}

export async function cancelAlarm(alarmId: string, reason?: string): Promise<CancelResult> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) {
    return { ok: false, error: "Admin only." };
  }
  if (!/^[0-9a-f-]{36}$/i.test(alarmId)) {
    return { ok: false, error: "invalid alarm id" };
  }
  const supabase = db();
  const { error } = await supabase
    .from("wake_up_alarms")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason ?? `cancelled via dashboard by ${me.email}`,
    })
    .eq("id", alarmId)
    .in("status", ["pending", "firing"]);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/alarms");
  return { ok: true };
}
