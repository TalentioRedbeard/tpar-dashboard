"use server";

// Server action for /dispatch dispositions — one row per (item_type, item_id) in
// dispatch_acks. Status comes from the shared taxonomy in ./dispositions. Optional
// note. set_by_email + set_by_short_name attribute the writer. Resolving statuses
// auto-collapse the item (the page handles the hide); "clear" deletes the row.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import {
  type DispatchAckStatus,
  type DispatchItemType,
  ALL_STATUSES,
  VALID_ITEM_TYPES,
  DISPOSITION_LABEL,
  dispositionEntityKey,
} from "./dispositions";

export type AckActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

async function requireWriter(): Promise<{ email: string; short_name: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  // admin + manager + production_manager + lead techs may set a disposition
  const isLead = !!me.tech?.is_lead;
  if (!(me.isAdmin || me.isManager || isLead)) {
    return { error: "not authorized — admin, manager, or lead tech only" };
  }
  return {
    email: me.email,
    short_name: me.tech?.tech_short_name ?? me.email.split("@")[0],
  };
}

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
  const hcp_job_id = (String(formData.get("hcp_job_id") ?? "").trim()) || null;

  if (!(VALID_ITEM_TYPES as string[]).includes(item_type)) return { ok: false, message: `invalid item_type: ${item_type}` };
  if (!item_id) return { ok: false, message: "missing item_id" };

  const supa = db();

  // Canonical entity key — the SAME job across lane / Stale / Needs-scheduling /
  // Week-ahead resolves to one key, so a status set in any window syncs to all.
  const entity_key = dispositionEntityKey(item_type, item_id, hcp_job_id);

  // Clear = remove the disposition for this entity everywhere it shows.
  if (status === "clear") {
    const { error } = await supa.from("dispatch_acks").delete().eq("entity_key", entity_key);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/dispatch");
    return { ok: true, message: "cleared" };
  }

  if (!(ALL_STATUSES as string[]).includes(status)) {
    return { ok: false, message: `invalid status: ${status}` };
  }

  // One disposition per entity: clear any prior rows for this entity (set from
  // any window), then write the new one — keeps cross-window state consistent.
  const now = new Date().toISOString();
  await supa.from("dispatch_acks").delete().eq("entity_key", entity_key);
  const { error } = await supa.from("dispatch_acks").insert({
    item_type,
    item_id,
    entity_key,
    status,
    note,
    set_by_email: writer.email,
    set_by_short_name: writer.short_name,
    set_at: now,
    updated_at: now,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/dispatch");

  return { ok: true, message: DISPOSITION_LABEL[status as DispatchAckStatus] };
}
