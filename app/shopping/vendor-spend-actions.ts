"use server";

// Inventory Phase 1 — "Where your money goes". Reads the reconciled vendor
// spend (vendor_spend_summary_v) so split vendor names are folded into the
// canonical distributor and material is separated from overhead. Financial data
// → leadership-only (admin/manager), same gate as other money surfaces.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type VendorSpendRow = {
  vendor_name: string;
  is_known_distributor: boolean;
  receipt_count: number;
  material_spend: number;
  overhead_spend: number;
  last_purchase: string | null;
};

export type VendorSpend = {
  vendors: VendorSpendRow[];
  totalMaterial: number;
  totalOverhead: number;
  knownCount: number;
  vendorCount: number;
} | null;

export async function loadVendorSpend(): Promise<VendorSpend> {
  const me = await getCurrentTech();
  if (!me || (!me.isAdmin && !me.isManager)) return null; // financial — leadership only

  const supa = db();
  const { data } = await supa
    .from("vendor_spend_summary_v")
    .select("vendor_name, is_known_distributor, receipt_count, material_spend, overhead_spend, last_purchase")
    .order("material_spend", { ascending: false });

  const rows = (data ?? []) as VendorSpendRow[];
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const totalMaterial = rows.reduce((s, r) => s + num(r.material_spend), 0);
  const totalOverhead = rows.reduce((s, r) => s + num(r.overhead_spend), 0);

  return {
    vendors: rows.slice(0, 15).map((r) => ({
      vendor_name: r.vendor_name,
      is_known_distributor: r.is_known_distributor,
      receipt_count: num(r.receipt_count),
      material_spend: num(r.material_spend),
      overhead_spend: num(r.overhead_spend),
      last_purchase: r.last_purchase,
    })),
    totalMaterial: Math.round(totalMaterial * 100) / 100,
    totalOverhead: Math.round(totalOverhead * 100) / 100,
    knownCount: rows.filter((r) => r.is_known_distributor).length,
    vendorCount: rows.length,
  };
}
