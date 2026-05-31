"use server";

// Comms-driven triage for /dispatch (Danny 2026-05-31). suggestTriage asks the
// dispatch-triage edge fn to PROPOSE a disposition for each open item based on
// recent customer comms; applyTriageDisposition writes the chosen one to the
// same dispatch_acks the manual buttons use. Nothing auto-applies — the
// dispatcher reviews each proposal, so no work is dropped. Dispatch-role gated.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type TriageProposal = {
  id: string;
  proposed_status: string;
  reason: string;
  next_step?: string;
  confidence: "high" | "medium" | "low";
};
export type TriageItemInput = {
  id: string;
  item_type: string;
  customer_id?: string | null;
  customer_name?: string | null;
  current_status?: string | null;
  age_days?: number | null;
  context?: string | null;
};

const TRIAGE_URL = `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/dispatch-triage`;

const VALID_STATUSES = new Set(["needs_followup", "needs_review", "needs_advise", "scheduled_active", "addressed", "declined", "awaiting_client", "deferred", "completed", "test_internal", "no_response_stale", "paused"]);
const VALID_ITEM_TYPES = new Set(["appointment", "stale_appointment", "needs_scheduling", "comm_event"]);

export async function suggestTriage(items: TriageItemInput[]): Promise<{ ok: true; proposals: TriageProposal[] } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return { ok: false, error: "Dispatch role required." };
  if (!items.length) return { ok: true, proposals: [] };
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  try {
    const res = await fetch(TRIAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ items: items.slice(0, 40) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) return { ok: false, error: json?.error ?? `triage ${res.status}` };
    return { ok: true, proposals: (json.proposals ?? []) as TriageProposal[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyTriageDisposition(item_type: string, item_id: string, status: string, note: string | null): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return { ok: false, error: "Dispatch role required." };
  if (!VALID_ITEM_TYPES.has(item_type)) return { ok: false, error: "invalid item_type" };
  if (!VALID_STATUSES.has(status)) return { ok: false, error: "invalid status" };
  if (!item_id) return { ok: false, error: "missing item_id" };
  const now = new Date().toISOString();
  const { error } = await db().from("dispatch_acks").upsert({
    item_type,
    item_id,
    status,
    note: note?.slice(0, 500) || null,
    set_by_email: me.email,
    set_by_short_name: me.tech?.tech_short_name ?? null,
    set_at: now,
    updated_at: now,
  }, { onConflict: "item_type,item_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}
