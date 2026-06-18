"use server";

// Inventory Phase 3 — vendor price comparison + price book. Reads the inv_*
// views (cents) and surfaces, per canonical item, what each vendor charges
// (cheapest flagged + the spread), plus a price book of everything we've bought.
// Pricing/cost data → leadership-only (admin/manager), same gate as spend.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type VendorPrice = {
  vendor: string;
  unit_cents: number;
  observed_on: string | null;
  obs: number;
  descr: string | null;   // the part AS this vendor lists it — so mismatches are visible
  stale: boolean;
};

export type PriceComparison = {
  item_id: number;
  item_name: string;
  category_name: string | null;
  sell_unit: string;       // curated: '20 ft length' / 'each' / …
  compare_uom: string;     // 'per ft' (normalized) or 'each' (raw)
  n_vendors: number;
  min_cents: number;
  max_cents: number;
  savings_cents: number;
  savings_pct: number;
  cheapest_vendor: string;
  last_observed: string | null;
  vendors: VendorPrice[];
};

export type PriceBookRow = {
  vendor_sku_id: number;
  distributor_name: string;
  vendor_sku: string | null;
  vendor_description: string;
  item_name: string | null;
  obs: number;
  latest_cents: number;
  min_cents: number;
  max_cents: number;
  last_observed: string | null;
};

export type PriceIntel = {
  comparisons: PriceComparison[];
  priceBook: PriceBookRow[];
  comparedItems: number;
  pricedSkus: number;
} | null;

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function loadPriceIntel(): Promise<PriceIntel> {
  const me = await getCurrentTech();
  if (!me || (!me.isAdmin && !me.isManager)) return null; // pricing/cost → leadership only

  const supa = db();
  const [cmpRes, bookRes] = await Promise.all([
    supa.from("inv_price_comparison_v").select("*").order("savings_cents", { ascending: false }).limit(100),
    supa.from("inv_vendor_sku_pricebook_v").select("*").order("last_observed", { ascending: false, nullsFirst: false }).limit(250),
  ]);

  const comparisons: PriceComparison[] = (cmpRes.data ?? []).map((r: Record<string, unknown>) => ({
    item_id: num(r.item_id),
    item_name: String(r.item_name ?? ""),
    category_name: (r.category_name as string | null) ?? null,
    sell_unit: String(r.sell_unit ?? "each"),
    compare_uom: String(r.compare_uom ?? "each"),
    n_vendors: num(r.n_vendors),
    min_cents: num(r.min_cents),
    max_cents: num(r.max_cents),
    savings_cents: num(r.savings_cents),
    savings_pct: num(r.savings_pct),
    cheapest_vendor: String(r.cheapest_vendor ?? ""),
    last_observed: (r.last_observed as string | null) ?? null,
    vendors: Array.isArray(r.vendors)
      ? (r.vendors as Array<Record<string, unknown>>).map((v) => ({
          vendor: String(v.vendor ?? ""), unit_cents: num(v.unit_cents),
          observed_on: (v.observed_on as string | null) ?? null,
          obs: num(v.obs), descr: (v.descr as string | null) ?? null, stale: v.stale === true,
        }))
      : [],
  }));

  const priceBook: PriceBookRow[] = (bookRes.data ?? []).map((r: Record<string, unknown>) => ({
    vendor_sku_id: num(r.vendor_sku_id),
    distributor_name: String(r.distributor_name ?? ""),
    vendor_sku: (r.vendor_sku as string | null) ?? null,
    vendor_description: String(r.vendor_description ?? ""),
    item_name: (r.item_name as string | null) ?? null,
    obs: num(r.obs),
    latest_cents: num(r.latest_cents),
    min_cents: num(r.min_cents),
    max_cents: num(r.max_cents),
    last_observed: (r.last_observed as string | null) ?? null,
  }));

  return {
    comparisons,
    priceBook,
    comparedItems: comparisons.length,
    pricedSkus: priceBook.length,
  };
}
