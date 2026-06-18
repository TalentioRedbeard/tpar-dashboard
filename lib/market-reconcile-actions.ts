"use server";

// Market reconcile / learning loop (step 3, 2026-06-18). The office confirms or corrects the
// matcher's proposed vendor→canonical mapping; confirming writes back (source='human',
// confirmed_at) AND propagates to other unconfirmed lines with the identical description
// (source='learned') — so the auto-fill climbs toward 100% as it's used. match_canonical
// (size/material/type-aware RPC) supplies the candidate list. Admin+manager only.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

async function gate() {
  const me = await getCurrentTech().catch(() => null);
  return me && (me.isAdmin || me.isManager) ? me : null;
}

const n = (v: unknown) => (v == null ? null : Number(v));

export type QueueRow = {
  id: number; distributor: string; vendor_description: string;
  unit_price_cents: number | null; uom: string | null;
  proposed_id: number | null; proposed_name: string | null; match_sim: number | null;
};

export async function getReconcileQueue(): Promise<QueueRow[]> {
  const me = await gate();
  if (!me) return [];
  const { data } = await db()
    .from("vendor_item_map")
    .select("id, distributor, vendor_description, unit_price_cents, uom, canonical_item_id, match_sim")
    .is("confirmed_at", null)
    .order("match_sim", { ascending: false, nullsFirst: false })
    .limit(250);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = [...new Set(rows.map((r) => r.canonical_item_id as number | null).filter((x): x is number => !!x))];
  const nameMap = new Map<number, string>();
  if (ids.length) {
    const { data: cs } = await db().from("canonical_items").select("id, canonical_name").in("id", ids);
    for (const c of (cs ?? []) as Array<Record<string, unknown>>) nameMap.set(c.id as number, c.canonical_name as string);
  }
  return rows.map((r) => ({
    id: r.id as number,
    distributor: (r.distributor as string) ?? "",
    vendor_description: (r.vendor_description as string) ?? "",
    unit_price_cents: n(r.unit_price_cents),
    uom: (r.uom as string | null) ?? null,
    proposed_id: (r.canonical_item_id as number | null) ?? null,
    proposed_name: r.canonical_item_id ? nameMap.get(r.canonical_item_id as number) ?? null : null,
    match_sim: n(r.match_sim),
  }));
}

export type Candidate = { id: number; name: string; size: string | null; score: number; size_ok: boolean; mat_ok: boolean; type_ok: boolean };

export async function candidatesForVendorLine(vmId: number): Promise<Candidate[]> {
  const me = await gate();
  if (!me) return [];
  const { data: vm } = await db().from("vendor_item_map").select("vendor_description").eq("id", vmId).maybeSingle();
  const desc = (vm as { vendor_description?: string } | null)?.vendor_description;
  if (!desc) return [];
  const { data } = await db().rpc("match_canonical", { p_desc: desc, p_lim: 6 });
  return ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: c.canonical_item_id as number, name: c.canonical_name as string, size: (c.item_size as string | null) ?? null,
    score: Number(c.score) || 0, size_ok: c.size_ok === true, mat_ok: c.mat_ok === true, type_ok: c.type_ok === true,
  }));
}

export async function searchCanonical(q: string): Promise<Array<{ id: number; name: string; size: string | null }>> {
  const me = await gate();
  if (!me) return [];
  const safe = q.replace(/[,()*%]/g, " ").trim();
  if (safe.length < 2) return [];
  const { data } = await db().from("canonical_items").select("id, canonical_name, size")
    .or(`canonical_name.ilike.%${safe}%,description.ilike.%${safe}%`).limit(14);
  return ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({ id: c.id as number, name: c.canonical_name as string, size: (c.size as string | null) ?? null }));
}

export async function confirmVendorMatch(vmId: number, canonicalId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await gate();
  if (!me) return { ok: false, error: "unauthorized" };
  const supa = db();
  const { data: vm } = await supa.from("vendor_item_map").select("vendor_description, uom, unit_price_cents").eq("id", vmId).maybeSingle();
  const { data: ci } = await supa.from("canonical_items").select("base_uom, pack_qty").eq("id", canonicalId).maybeSingle();
  const v = vm as { vendor_description?: string; uom?: string | null; unit_price_cents?: number | null } | null;
  const c = ci as { base_uom?: string; pack_qty?: number | null } | null;
  let perBase: number | null = null;
  if (v?.unit_price_cents != null && c) {
    if (v.uom === "ft") perBase = v.unit_price_cents;
    else if (c.base_uom === "ft" && c.pack_qty && Number(c.pack_qty) > 0) perBase = Math.round(v.unit_price_cents / Number(c.pack_qty));
    else perBase = v.unit_price_cents;
  }
  const { error } = await supa.from("vendor_item_map")
    .update({ canonical_item_id: canonicalId, confirmed_at: new Date().toISOString(), confirmed_by: me.email, source: "human", confidence: 1, per_base_cents: perBase })
    .eq("id", vmId);
  if (error) return { ok: false, error: error.message };
  // learn: pre-fill other unconfirmed lines with the identical description
  if (v?.vendor_description) {
    await supa.from("vendor_item_map").update({ canonical_item_id: canonicalId, source: "learned" })
      .is("confirmed_at", null).eq("vendor_description", v.vendor_description).neq("id", vmId);
  }
  revalidatePath("/shopping/reconcile");
  return { ok: true };
}

export async function rejectVendorMatch(vmId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await gate();
  if (!me) return { ok: false, error: "unauthorized" };
  const { error } = await db().from("vendor_item_map")
    .update({ canonical_item_id: null, confirmed_at: new Date().toISOString(), confirmed_by: me.email, source: "rejected" })
    .eq("id", vmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping/reconcile");
  return { ok: true };
}
