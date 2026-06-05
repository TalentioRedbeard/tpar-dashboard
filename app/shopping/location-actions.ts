"use server";

// Supplier branch locations for the /shopping directory. Operational supplier
// contact info — any signed-in user (techs call suppliers from the field).

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type SupplierLocation = {
  id: number;
  distributor_id: string | null;
  supplier_name: string;
  label: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  hours: string | null;
  notes: string | null;
};

// Grouped by distributor_id (or `name:<supplier>` when not linked to a distributor row).
export async function loadDistributorLocations(): Promise<Record<string, SupplierLocation[]>> {
  const me = await getCurrentTech();
  if (!me) return {};
  const supa = db();
  const { data } = await supa
    .from("distributor_locations")
    .select("id, distributor_id, supplier_name, label, address, phone, website, hours, notes")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  const map: Record<string, SupplierLocation[]> = {};
  for (const r of (data ?? []) as SupplierLocation[]) {
    const k = r.distributor_id ?? `name:${r.supplier_name}`;
    (map[k] ??= []).push(r);
  }
  return map;
}

export type LocationInput = {
  id?: number;
  distributorId: string | null;
  supplierName: string;
  label: string;
  address?: string;
  phone?: string;
  website?: string;
  hours?: string;
};

export async function upsertLocation(input: LocationInput): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) return { ok: false, error: "Admins only." };
  const label = (input.label || "").trim();
  if (!label) return { ok: false, error: "Branch label is required." };
  const supa = db();
  const row: Record<string, unknown> = {
    distributor_id: input.distributorId,
    supplier_name: input.supplierName,
    label,
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    website: input.website?.trim() || null,
    hours: input.hours?.trim() || null,
    source: "manual",
    updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await supa.from("distributor_locations").update(row).eq("id", input.id)
    : await supa.from("distributor_locations").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}

export async function deleteLocation(id: number): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) return { ok: false, error: "Admins only." };
  const { error } = await db().from("distributor_locations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}
