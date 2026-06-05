"use server";

// Inventory 2c-2 — the self-maintenance Review queue. Surfaces the grey-band
// vendor-SKU candidates (match_status='needs_review') for a one-tap ruling:
// confirm the proposed link, reject, or accept it as a new catalog part. A
// confirm is PERMANENT (the matcher never re-asks). Leadership-gated.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type ReviewCandidate = {
  id: number;
  vendor_description: string;
  distributor_name: string | null;
  times_seen: number;
  match_confidence: number | null;
  proposed_item_id: number | null;
  proposed_item_name: string | null;
  proposed_item_category: string | null;
};

async function gate() {
  const me = await getCurrentTech();
  return me && (me.isAdmin || me.isManager) ? me : null;
}

export async function loadReviewQueue(): Promise<{ items: ReviewCandidate[]; proposable: number; noMatch: number; total: number } | null> {
  if (!(await gate())) return null;
  const supa = db();
  const { data } = await supa
    .from("inv_vendor_skus")
    .select("id, vendor_description, times_seen, match_confidence, item_id, distributors(name), inv_items(canonical_name, inv_categories(name))")
    .eq("match_status", "needs_review")
    .order("item_id", { ascending: false, nullsFirst: false }) // proposable first
    .order("times_seen", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as Array<Record<string, any>>;
  const items: ReviewCandidate[] = rows.map((r) => ({
    id: r.id,
    vendor_description: r.vendor_description,
    distributor_name: r.distributors?.name ?? null,
    times_seen: r.times_seen ?? 1,
    match_confidence: r.match_confidence,
    proposed_item_id: r.item_id ?? null,
    proposed_item_name: r.inv_items?.canonical_name ?? null,
    proposed_item_category: r.inv_items?.inv_categories?.name ?? null,
  }));

  // queue-wide counts (not just the page)
  const { count: proposable } = await supa.from("inv_vendor_skus").select("id", { count: "exact", head: true }).eq("match_status", "needs_review").not("item_id", "is", null);
  const { count: noMatch } = await supa.from("inv_vendor_skus").select("id", { count: "exact", head: true }).eq("match_status", "needs_review").is("item_id", null);
  return { items, proposable: proposable ?? 0, noMatch: noMatch ?? 0, total: (proposable ?? 0) + (noMatch ?? 0) };
}

// Confirm the proposed link — permanent.
export async function confirmCandidate(skuId: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await gate())) return { ok: false, error: "not authorized" };
  const supa = db();
  const { data: row } = await supa.from("inv_vendor_skus").select("item_id").eq("id", skuId).maybeSingle();
  if (!row?.item_id) return { ok: false, error: "no proposed item to confirm" };
  const { error } = await supa.from("inv_vendor_skus").update({ match_status: "confirmed", match_confidence: 1 }).eq("id", skuId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}

export async function rejectCandidate(skuId: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await gate())) return { ok: false, error: "not authorized" };
  const supa = db();
  const { error } = await supa.from("inv_vendor_skus").update({ match_status: "rejected", item_id: null }).eq("id", skuId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}

// Accept an unrecognized SKU as a NEW catalog part (the catalog accretes). The
// new item gets categorized by the nightly/backfill categorizer (category null).
export async function createItemFromCandidate(skuId: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await gate())) return { ok: false, error: "not authorized" };
  const supa = db();
  const { data: cand } = await supa.from("inv_vendor_skus").select("id, vendor_description, vendor_sku").eq("id", skuId).maybeSingle();
  if (!cand) return { ok: false, error: "candidate not found" };
  const name = String(cand.vendor_description || "").replace(/^[A-Za-z0-9/-]{3,}\s+/, "").trim() || String(cand.vendor_description || "");
  const normalized = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const { data: item, error: insErr } = await supa
    .from("inv_items")
    .insert({ canonical_name: cand.vendor_description, normalized_name: normalized, source: "review_new" })
    .select("id").single();
  if (insErr || !item) return { ok: false, error: insErr?.message ?? "create failed" };
  const { error } = await supa.from("inv_vendor_skus").update({ item_id: item.id, match_status: "confirmed", match_confidence: 1 }).eq("id", skuId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}
