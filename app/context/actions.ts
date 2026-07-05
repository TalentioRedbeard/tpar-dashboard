"use server";

// Server actions behind /context — the CUSTOMER human-context review queue
// (sibling of /conversation's owner-context gate in wrap-actions.ts). The
// on-prem worker mines discreet per-customer context from comms into
// customer_context (status='pending_review'); nothing is "kept" until the
// owner keeps it here. Owner-gated, matching the page.
// Consequence tier T1 — one row update per press.

import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type ContextActionResult = { ok: true } | { ok: false; error: string };

export async function reviewCustomerContext(input: {
  id: string;
  decision: "kept" | "rejected";
}): Promise<ContextActionResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, error: "owner only" };
  if (!input.id) return { ok: false, error: "missing id" };
  if (input.decision !== "kept" && input.decision !== "rejected") return { ok: false, error: "bad decision" };

  const supa = db();
  // Guard on status so a stale double-press can't flip an already-reviewed item.
  const { data, error } = await supa
    .from("customer_context")
    .update({ status: input.decision, reviewed_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("status", "pending_review")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "already reviewed — refresh the page" };

  revalidatePath("/context");
  return { ok: true };
}

// Flip an item between staff-visible ('internal') and owner-eyes-only
// ('owner_only') BEFORE keeping it — only pending items can be re-tiered here.
export async function setContextSensitivity(input: {
  id: string;
  sensitivity: "internal" | "owner_only";
}): Promise<ContextActionResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, error: "owner only" };
  if (!input.id) return { ok: false, error: "missing id" };
  if (input.sensitivity !== "internal" && input.sensitivity !== "owner_only") {
    return { ok: false, error: "bad sensitivity" };
  }

  const supa = db();
  const { data, error } = await supa
    .from("customer_context")
    .update({ sensitivity: input.sensitivity })
    .eq("id", input.id)
    .eq("status", "pending_review")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "already reviewed — refresh the page" };

  revalidatePath("/context");
  return { ok: true };
}
