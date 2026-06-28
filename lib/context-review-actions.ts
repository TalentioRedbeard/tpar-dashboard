"use server";

// P3 review gate — the owner confirms/rejects the human-context entries the on-prem 14B proposed
// from recorded conversations. Everything is human-confirmed (Danny's locked decision); nothing
// auto-acts. Category-D (sensitive) context lives VM-local ONLY and is NOT surfaced here.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type ProposedContext = {
  id: string;
  category: string;
  note: string;
  confidence: number | null;
  hcp_customer_id: string | null;
  conversation_id: string | null;
  created_at: string;
};

async function owner() {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) return null;
  return me;
}

export async function listProposedContext(): Promise<ProposedContext[]> {
  const me = await owner();
  if (!me) return [];
  const { data } = await db()
    .from("customer_context")
    .select("id,category,note,confidence,hcp_customer_id,conversation_id,created_at")
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(300);
  return (data ?? []) as ProposedContext[];
}

export async function reviewContext(
  id: string,
  decision: "confirmed" | "rejected",
): Promise<{ ok: boolean }> {
  const me = await owner();
  if (!me) return { ok: false };
  await db()
    .from("customer_context")
    .update({ status: decision, reviewed_by: me.realEmail ?? me.email, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "proposed");
  revalidatePath("/context/review");
  return { ok: true };
}
