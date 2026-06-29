"use server";

// P4 review UI — request a context-aware draft for a customer + review/send it. The on-prem
// generation worker fills requests with the local 70B (drafts only; nothing auto-sends). "Sent" is
// a deliberate human action here (status flip) — actual delivery happens wherever Danny sends it.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type DraftRow = {
  id: string;
  task: string;
  hcp_customer_id: string | null;
  status: string;
  model: string | null;
  draft_text: string | null;
  private_context_count: number | null;
  context_used: { category: string; note: string }[] | null;
  error: string | null;
  created_at: string;
};

async function owner() {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) return null;
  return me;
}

export async function listDrafts(): Promise<DraftRow[]> {
  const me = await owner();
  if (!me) return [];
  const { data } = await db()
    .from("generated_drafts")
    .select("id,task,hcp_customer_id,status,model,draft_text,private_context_count,context_used,error,created_at")
    .in("status", ["requested", "drafting", "draft", "failed"])
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as DraftRow[];
}

export async function requestDraft(input: { hcpCustomerId: string; task: string }): Promise<{ ok: boolean; error?: string }> {
  const me = await owner();
  if (!me) return { ok: false, error: "owner only" };
  if (!input.hcpCustomerId) return { ok: false, error: "pick a customer" };
  const task = ["greeting", "estimate", "report"].includes(input.task) ? input.task : "greeting";
  const { error } = await db().from("generated_drafts").insert({
    task, hcp_customer_id: input.hcpCustomerId, status: "requested", requested_by: me.realEmail ?? me.email,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/drafts");
  return { ok: true };
}

export async function markDraftSent(id: string): Promise<{ ok: boolean }> {
  const me = await owner();
  if (!me) return { ok: false };
  await db().from("generated_drafts").update({ status: "sent" }).eq("id", id).eq("status", "draft");
  revalidatePath("/drafts");
  return { ok: true };
}

export async function discardDraft(id: string): Promise<{ ok: boolean }> {
  const me = await owner();
  if (!me) return { ok: false };
  await db().from("generated_drafts").update({ status: "discarded" }).eq("id", id);
  revalidatePath("/drafts");
  return { ok: true };
}
