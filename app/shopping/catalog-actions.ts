"use server";

// Interactive parts catalog (2026-06-18). Browse the in-house canonical catalog with blended
// real prices (receipts + confirmed quotes) per vendor, plus ordering + delivery info. Reads
// canonical_market_v. Leadership-only (pricing); filters: category, material, text, priced-only.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type CatalogVendor = {
  vendor: string;
  cents: number;
  obs: number;
  last_observed: string | null;
  descr: string | null;
  source: "receipt" | "quote";
  phone: string | null;
  order_email: string | null;
  account: string | null;
  can_email_order: boolean | null;
  delivers: boolean | null;
  offers_pickup: boolean | null;
  lead_days: number | null;
  fee_cents: number | null;
  min_cents: number | null;
  cutoff: string | null;
};

export type CatalogItem = {
  id: number;
  name: string;
  size: string | null;
  category: string | null;
  item_type: string | null;
  material_tags: string[];
  sell_unit: string | null;
  base_uom: string | null;
  vendor_count: number;
  best_vendor: string | null;
  best_cents: number | null;
  hi_cents: number | null;
  last_observed: string | null;
  vendors: CatalogVendor[];
};

export type CatalogFacets = { categories: string[]; materials: string[] };

const num = (v: unknown) => (v == null ? null : Number(v));

async function gate() {
  const me = await getCurrentTech().catch(() => null);
  return me && (me.isAdmin || me.isManager) ? me : null;
}

const MATERIALS = ["brass", "pvc", "cpvc", "pex", "copper", "stainless", "galvanized", "black steel", "rubber"];

export async function getCatalogFacets(): Promise<CatalogFacets> {
  if (!(await gate())) return { categories: [], materials: [] };
  const { data } = await db().from("canonical_market_v").select("category");
  const cats = [...new Set((data ?? []).map((r: Record<string, unknown>) => r.category as string | null).filter(Boolean) as string[])].sort();
  return { categories: cats, materials: MATERIALS };
}

export async function loadCatalog(opts: {
  category?: string | null;
  material?: string | null;
  q?: string | null;
  pricedOnly?: boolean;
}): Promise<CatalogItem[]> {
  if (!(await gate())) return [];
  let query = db().from("canonical_market_v").select("*");
  if (opts.pricedOnly) query = query.gt("vendor_count", 0);
  if (opts.category) query = query.eq("category", opts.category);
  if (opts.material) query = query.contains("material_tags", [opts.material]);
  const q = (opts.q ?? "").trim();
  if (q.length >= 2) query = query.ilike("canonical_name", `%${q.replace(/[%,]/g, " ")}%`);
  query = query.order("vendor_count", { ascending: false }).order("canonical_name").limit(500);

  const { data } = await query;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.canonical_item_id),
    name: String(r.canonical_name ?? ""),
    size: (r.size as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    item_type: (r.item_type as string | null) ?? null,
    material_tags: Array.isArray(r.material_tags) ? (r.material_tags as string[]) : [],
    sell_unit: (r.sell_unit as string | null) ?? null,
    base_uom: (r.base_uom as string | null) ?? null,
    vendor_count: Number(r.vendor_count) || 0,
    best_vendor: (r.best_vendor as string | null) ?? null,
    best_cents: num(r.best_cents),
    hi_cents: num(r.hi_cents),
    last_observed: (r.last_observed as string | null) ?? null,
    vendors: Array.isArray(r.vendors)
      ? (r.vendors as Array<Record<string, unknown>>).map((v) => ({
          vendor: String(v.vendor ?? "(unknown)"),
          cents: Number(v.cents) || 0,
          obs: Number(v.obs) || 0,
          last_observed: (v.last_observed as string | null) ?? null,
          descr: (v.descr as string | null) ?? null,
          source: v.source === "quote" ? "quote" : "receipt",
          phone: (v.phone as string | null) ?? null,
          order_email: (v.order_email as string | null) ?? null,
          account: (v.account as string | null) ?? null,
          can_email_order: (v.can_email_order as boolean | null) ?? null,
          delivers: (v.delivers as boolean | null) ?? null,
          offers_pickup: (v.offers_pickup as boolean | null) ?? null,
          lead_days: num(v.lead_days),
          fee_cents: num(v.fee_cents),
          min_cents: num(v.min_cents),
          cutoff: (v.cutoff as string | null) ?? null,
        }))
      : [],
  }));
}
