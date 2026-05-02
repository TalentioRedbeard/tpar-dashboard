"use server";

// Server actions for the wake-up alarm admin surface.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type CancelResult =
  | { ok: true }
  | { ok: false; error: string };

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
