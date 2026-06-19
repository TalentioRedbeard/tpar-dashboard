"use server";

// Market reverse-lookup (step 5, 2026-06-18). Plumber types a part in plain language →
// market_lookup resolves it to the in-house canonical catalog and returns what each vendor
// actually charges (real receipt history via the inv→canonical link, + confirmed curated
// quotes), cheapest-first, with supplier contact. Pricing = leadership-only (admin/manager),
// same gate as the price-intel panel.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type MarketVendor = {
  vendor: string;
  cents: number;
  obs: number;
  last_observed: string | null;
  descr: string | null;
  source: "receipt" | "quote";
  phone: string | null;
  order_email: string | null;
  account: string | null;
};

export type MarketResult = {
  canonical_item_id: number;
  canonical_name: string;
  size: string | null;
  category: string | null;
  size_ok: boolean;
  mat_ok: boolean;
  type_ok: boolean;
  vendor_count: number;
  best_vendor: string | null;
  best_cents: number | null;
  hi_cents: number | null;
  last_observed: string | null;
  vendors: MarketVendor[];
};

const n = (v: unknown) => (v == null ? null : Number(v));

export async function marketLookup(term: string): Promise<MarketResult[]> {
  const me = await getCurrentTech().catch(() => null);
  if (!me || (!me.isAdmin && !me.isManager)) return []; // pricing → leadership only
  const q = (term ?? "").trim();
  if (q.length < 2) return [];

  const { data, error } = await db().rpc("market_lookup", { p_term: q, p_lim: 10 });
  if (error || !Array.isArray(data)) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    canonical_item_id: Number(r.canonical_item_id),
    canonical_name: String(r.canonical_name ?? ""),
    size: (r.item_size as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    size_ok: r.size_ok === true,
    mat_ok: r.mat_ok === true,
    type_ok: r.type_ok === true,
    vendor_count: Number(r.vendor_count) || 0,
    best_vendor: (r.best_vendor as string | null) ?? null,
    best_cents: n(r.best_cents),
    hi_cents: n(r.hi_cents),
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
        }))
      : [],
  }));
}
