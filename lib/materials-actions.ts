"use server";

// Server actions for the per-job MATERIALS USED list (Danny 2026-06-15). Distinct
// from procurement needs (needs_log) — this is what got installed/used on the job,
// for costing + restock. Reads/writes via service-role db(); canWrite gate (admin/tech).
// Money: unit_cost_cents is a CENTS snapshot at log time (never the sell price).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type MaterialUsed = {
  id: string;
  hcp_job_id: string;
  inv_item_id: number | null;
  item_name: string;
  qty: number;
  uom: string | null;
  unit_cost_cents: number | null;
  notes: string | null;
  added_by: string | null;
  created_at: string;
};

export type MaterialResult = { ok: true; id: string } | { ok: false; error: string };
export type CatalogItem = { id: number; name: string; uom: string | null; cost_cents: number | null };

const MCOLS = "id, hcp_job_id, inv_item_id, item_name, qty, uom, unit_cost_cents, notes, added_by, created_at";

export async function getMaterialsUsedForJob(hcp_job_id: string): Promise<MaterialUsed[]> {
  const { data } = await db()
    .from("job_materials_used")
    .select(MCOLS)
    .eq("hcp_job_id", hcp_job_id)
    .is("voided_at", null)
    .order("created_at", { ascending: true });
  return (data ?? []) as MaterialUsed[];
}

// Typeahead over the active catalog (919 items). Returns name + uom + cost snapshot.
export async function searchInvItems(query: string): Promise<CatalogItem[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data } = await db()
    .from("inv_items")
    .select("id, canonical_name, default_uom, default_cost_cents")
    .eq("active", true)
    .ilike("canonical_name", `%${q}%`)
    .order("canonical_name", { ascending: true })
    .limit(12);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as number,
    name: r.canonical_name as string,
    uom: (r.default_uom as string | null) ?? null,
    cost_cents: (r.default_cost_cents as number | null) ?? null,
  }));
}

export async function addMaterialUsed(input: {
  hcp_job_id: string;
  item_name: string;
  qty?: number;
  uom?: string | null;
  inv_item_id?: number | null;
  unit_cost_cents?: number | null;
  notes?: string | null;
}): Promise<MaterialResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };
  const item_name = input.item_name.trim();
  if (!item_name) return { ok: false, error: "Item name required." };
  const qty = input.qty && Number.isFinite(input.qty) && input.qty > 0 ? input.qty : 1;

  const { data, error } = await db()
    .from("job_materials_used")
    .insert({
      hcp_job_id: input.hcp_job_id,
      inv_item_id: input.inv_item_id ?? null,
      item_name,
      qty,
      uom: input.uom?.trim() || null,
      unit_cost_cents: input.unit_cost_cents ?? null,
      notes: input.notes?.trim() || null,
      added_by: me.tech?.tech_short_name ?? me.email,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, id: data.id as string };
}

// Soft-delete (remove a mistaken entry).
export async function voidMaterialUsed(input: { id: string; hcp_job_id: string }): Promise<MaterialResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };
  const { error } = await db()
    .from("job_materials_used")
    .update({ voided_at: new Date().toISOString() })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, id: input.id };
}
