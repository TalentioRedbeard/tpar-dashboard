"use server";

// Server actions for /dispatch — operational status (ack) overlay on items.
//
// One row per (item_type, item_id) in dispatch_acks. Status comes from a fixed
// set. Optional note. set_by_email + set_by_short_name attribute the writer.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type DispatchAckStatus = "addressed" | "needs_followup" | "needs_review" | "needs_advise";
export type DispatchItemType = "appointment" | "stale_appointment" | "needs_scheduling" | "comm_event";

export type AckActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

async function requireWriter(): Promise<{ email: string; short_name: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  // admin + manager + production_manager + lead techs may set ack
  const isLead = !!me.tech?.is_lead;
  if (!(me.isAdmin || me.isManager || isLead)) {
    return { error: "not authorized — admin, manager, or lead tech only" };
  }
  return {
    email: me.email,
    short_name: me.tech?.tech_short_name ?? me.email.split("@")[0],
  };
}

const VALID_STATUSES: DispatchAckStatus[] = ["addressed", "needs_followup", "needs_review", "needs_advise"];
const VALID_TYPES: DispatchItemType[] = ["appointment", "stale_appointment", "needs_scheduling", "comm_event"];

export async function setDispatchAck(
  _prev: AckActionResult,
  formData: FormData,
): Promise<AckActionResult> {
  const writer = await requireWriter();
  if ("error" in writer) return { ok: false, message: writer.error };

  const item_type = String(formData.get("item_type") ?? "").trim() as DispatchItemType;
  const item_id   = String(formData.get("item_id")   ?? "").trim();
  const status    = String(formData.get("status")    ?? "").trim() as DispatchAckStatus | "clear";
  const noteRaw   = formData.get("note");
  const note      = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 500) || null : null;

  if (!VALID_TYPES.includes(item_type)) return { ok: false, message: `invalid item_type: ${item_type}` };
  if (!item_id) return { ok: false, message: "missing item_id" };

  const supa = db();

  // Clear = delete the row (item returns to "unset" state)
  if (status === "clear") {
    const { error } = await supa
      .from("dispatch_acks")
      .delete()
      .eq("item_type", item_type)
      .eq("item_id", item_id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/dispatch");
    return { ok: true, message: "cleared" };
  }

  if (!VALID_STATUSES.includes(status as DispatchAckStatus)) {
    return { ok: false, message: `invalid status: ${status}` };
  }

  // Upsert: one row per (item_type, item_id), updated_at refreshes on change
  const now = new Date().toISOString();
  const { error } = await supa
    .from("dispatch_acks")
    .upsert({
      item_type,
      item_id,
      status,
      note,
      set_by_email: writer.email,
      set_by_short_name: writer.short_name,
      set_at: now,        // first-set time (overwritten on each change for simplicity)
      updated_at: now,
    }, { onConflict: "item_type,item_id" });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/dispatch");

  const label = status === "addressed" ? "✓ addressed"
              : status === "needs_followup" ? "↻ follow-up"
              : status === "needs_review" ? "👁 review"
              : "❓ advise";
  return { ok: true, message: label };
}
