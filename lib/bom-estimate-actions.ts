"use server";

// Deterministic materials hint for the estimate builder (BUILD 2 of the
// services↔parts bridge). Given a pricebook Q4 item name (which doubles as the
// service label), resolve the APPROVED service_bom for it and roll up its
// materials cost via the service_material_estimate RPC — the single source of
// truth (prices come from canonical_market_v; the RPC is STABLE + deterministic).
//
// Returns null whenever there is no approved BOM for the label, so the builder
// simply shows no hint. NEVER auto-fills — the tech accepts the suggestion.
// Access matches the estimate builder itself (tech / manager / admin).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type ServiceMaterials = {
  service_key: string;
  service_label: string;
  materials_cost_dollars: number;
  n_required: number;
  n_priced: number;
  coverage_pct: number;
  // Required parts that don't yet have a price (for the "partial — X, Y" note).
  unpriced_parts: string[];
};

type RpcLine = {
  part_name?: unknown;
  optional?: unknown;
  priced?: unknown;
};
type RpcRow = {
  service_key?: string;
  service_label?: string;
  status?: string;
  n_required?: number;
  n_priced?: number;
  coverage_pct?: number;
  materials_cost_dollars?: number | string;
  lines?: unknown;
};

export async function materialsForService(label: string): Promise<ServiceMaterials | null> {
  const term = (label ?? "").trim();
  if (!term) return null;

  // Same gate as the estimate builder / add-line flow.
  const me = await getCurrentTech().catch(() => null);
  if (!me || !(me.isAdmin || me.isManager || me.dashboardRole === "tech")) return null;

  const supa = db();
  // Resolve an APPROVED bom by its service label (case-insensitive exact match —
  // the Q4 item name IS the service label). ilike with no wildcards = exact ci.
  const { data: bomRow } = await supa
    .from("service_boms")
    .select("service_key")
    .eq("status", "approved")
    .ilike("service_label", term)
    .limit(1)
    .maybeSingle();
  if (!bomRow) return null;

  const key = (bomRow as { service_key: string }).service_key;
  const { data, error } = await supa.rpc("service_material_estimate", { p_service_key: key });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const row = data[0] as RpcRow;
  if (row.status !== "approved") return null;

  const lines = Array.isArray(row.lines) ? (row.lines as RpcLine[]) : [];
  const unpriced = lines
    .filter((l) => l.optional !== true && l.priced !== true)
    .map((l) => String(l.part_name ?? "").trim())
    .filter(Boolean);

  return {
    service_key: String(row.service_key ?? key),
    service_label: String(row.service_label ?? term),
    materials_cost_dollars: Number(row.materials_cost_dollars) || 0,
    n_required: Number(row.n_required) || 0,
    n_priced: Number(row.n_priced) || 0,
    coverage_pct: Number(row.coverage_pct) || 0,
    unpriced_parts: unpriced,
  };
}
