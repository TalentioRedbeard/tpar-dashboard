"use server";

// Server actions for the procurement / shopping list system (#127).
// Mirrors the Slack /need flow but lets users log + manage needs from the dashboard.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Urgency = "asap" | "today" | "this_week" | "this_month" | "no_rush";

export type NeedRow = {
  id: string;
  hub: "tpar" | "personal";
  submitted_by: string;
  submitted_via: string;
  item_description: string;
  qty: string | null;
  urgency: Urgency;
  hcp_job_id: string | null;
  vehicle_id: string | null;
  location_label: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  ordered_at: string | null;
  received_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
};

export type LogNeedResult =
  | { ok: true; need_id: string }
  | { ok: false; error: string };

export async function logNeed(input: {
  item_description: string;
  qty?: string;
  urgency: Urgency;
  hcp_job_id?: string;
  location_label?: string;
  notes?: string;
}): Promise<LogNeedResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "Not signed in." };
  if (!input.item_description?.trim()) return { ok: false, error: "Item description required." };

  const supabase = db();
  const { data, error } = await supabase
    .from("needs_log")
    .insert({
      hub: "tpar",
      submitted_by: me.tech?.tech_short_name ?? me.email,
      submitted_via: "dashboard",
      item_description: input.item_description.trim(),
      qty: input.qty?.trim() || null,
      urgency: input.urgency,
      hcp_job_id: input.hcp_job_id || null,
      location_label: input.location_label?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "logged",
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };
  revalidatePath("/shopping");
  if (input.hcp_job_id) revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, need_id: data.id as string };
}

export async function cancelNeed(input: { need_id: string; reason?: string }): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "Not signed in." };
  const supabase = db();
  const { error } = await supabase
    .from("needs_log")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: input.reason?.trim() || null,
    })
    .eq("id", input.need_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}

export async function fulfillNeed(input: { need_id: string }): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "Not signed in." };
  const supabase = db();
  const { error } = await supabase
    .from("needs_log")
    .update({
      status: "fulfilled",
      fulfilled_at: new Date().toISOString(),
    })
    .eq("id", input.need_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}

export async function getOpenNeeds(opts: { limit?: number; mineOnly?: boolean } = {}): Promise<NeedRow[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const supabase = db();
  let q = supabase
    .from("needs_log")
    .select("*")
    .neq("status", "fulfilled")
    .neq("status", "cancelled")
    .eq("hub", "tpar")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.mineOnly) q = q.eq("submitted_by", me.tech?.tech_short_name ?? me.email);

  const { data } = await q;
  return (data ?? []) as NeedRow[];
}

export async function getNeedsForJob(hcp_job_id: string): Promise<NeedRow[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const supabase = db();
  const { data } = await supabase
    .from("needs_log")
    .select("*")
    .eq("hcp_job_id", hcp_job_id)
    .order("created_at", { ascending: false });
  return (data ?? []) as NeedRow[];
}

export async function getRecentlyCompletedNeeds(limit = 20): Promise<NeedRow[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const supabase = db();
  const { data } = await supabase
    .from("needs_log")
    .select("*")
    .in("status", ["fulfilled", "cancelled"])
    .eq("hub", "tpar")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as NeedRow[];
}

// ─── Research layer — slice 2 of #127 ───────────────────────────────────
export type ResearchResult = {
  id: string;
  vendor: string;
  product_name: string;
  sku: string | null;
  unit_price_cents: number | null;
  total_price_cents: number | null;
  in_stock: boolean | null;
  url: string | null;
  source: string;
  notes: string | null;
  found_at: string;
};

export async function getResearchForNeed(need_id: string): Promise<ResearchResult[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const supabase = db();
  const { data } = await supabase
    .from("need_research_results")
    .select("id, vendor, product_name, sku, unit_price_cents, total_price_cents, in_stock, url, source, notes, found_at")
    .eq("need_id", need_id)
    .order("found_at", { ascending: false });
  return (data ?? []) as ResearchResult[];
}

export type ResearchInvokeResult =
  | { ok: true; candidates: number }
  | { ok: false; error: string };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function researchNeed(need_id: string): Promise<ResearchInvokeResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "Server missing SUPABASE env." };
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/procurement-research`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ need_id }),
    });
    const j = await r.json();
    if (!r.ok || !j?.ok) {
      return { ok: false, error: j?.error ?? `Research failed (${r.status})` };
    }
    revalidatePath("/shopping");
    return { ok: true, candidates: Number(j?.candidates ?? 0) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
