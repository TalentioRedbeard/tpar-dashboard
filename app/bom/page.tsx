// /bom — Service → Parts (bill of materials) review surface. Owner-gated (the
// same isAdmin gate as /conversation + /context). Reads service_boms +
// service_bom_lines, rolls up each BOM's materials cost via the deterministic
// service_material_estimate RPC (trust its numbers — prices come from
// canonical_market_v), and hands the review UI to BomReviewPanel. Approved BOMs
// feed the estimate builder's materials hint (lib/bom-estimate-actions).

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/supabase";
import {
  BomReviewPanel,
  type BomCard,
  type BomEstLine,
  type CategoryGroup,
  type DemandRow,
} from "@/components/BomReviewPanel";

export const dynamic = "force-dynamic";

type BomRow = {
  id: string;
  service_key: string;
  service_label: string;
  q2_category: string | null;
  q3_work_type: string | null;
  status: string;
  basis: string;
  model: string | null;
  notes: string | null;
};
type LineRow = {
  id: string;
  bom_id: string;
  part_name: string;
  canonical_item_id: number | null;
  qty: number | string;
  optional: boolean;
  note: string | null;
};
type RpcLine = {
  canonical_item_id?: number | null;
  priced?: boolean;
  unit_dollars?: number | null;
  best_vendor?: string | null;
};
type RpcRow = {
  status?: string;
  n_lines?: number;
  n_required?: number;
  n_matched?: number;
  n_priced?: number;
  materials_cost_dollars?: number | string;
  optional_cost_dollars?: number | string;
  coverage_pct?: number;
  lines?: unknown;
};

export default async function BomPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();

  const [bomsRes, demandRes] = await Promise.all([
    supa
      .from("service_boms")
      .select("id, service_key, service_label, q2_category, q3_work_type, status, basis, model, notes")
      .in("status", ["pending", "approved"])
      .order("q2_category", { ascending: true, nullsFirst: false })
      .order("service_label", { ascending: true })
      .limit(1000),
    // Catalog demand: unmatched lines grouped in JS (supabase-js has no GROUP BY).
    supa
      .from("service_bom_lines")
      .select("part_name, bom_id")
      .is("canonical_item_id", null)
      .limit(4000),
  ]);

  const loadError = bomsRes.error?.message ?? null;
  const boms = (bomsRes.data ?? []) as BomRow[];

  // Lines for every BOM shown (id-carrying — needed for edit actions).
  const bomIds = boms.map((b) => b.id);
  let lineRows: LineRow[] = [];
  if (bomIds.length > 0) {
    const { data } = await supa
      .from("service_bom_lines")
      .select("id, bom_id, part_name, canonical_item_id, qty, optional, note")
      .in("bom_id", bomIds)
      .order("created_at", { ascending: true })
      .limit(8000);
    lineRows = (data ?? []) as LineRow[];
  }
  const linesByBom = new Map<string, LineRow[]>();
  for (const l of lineRows) {
    const arr = linesByBom.get(l.bom_id);
    if (arr) arr.push(l); else linesByBom.set(l.bom_id, [l]);
  }

  // Deterministic materials rollup per BOM (the RPC is the source of truth).
  const rpcResults = await Promise.all(
    boms.map(async (b) => {
      const { data } = await supa.rpc("service_material_estimate", { p_service_key: b.service_key });
      const row = Array.isArray(data) && data.length > 0 ? (data[0] as RpcRow) : null;
      return [b.id, row] as const;
    }),
  );
  const rpcByBom = new Map<string, RpcRow | null>(rpcResults);

  function toCard(b: BomRow): BomCard {
    const rpc = rpcByBom.get(b.id) ?? null;
    // Per-line pricing keyed by canonical_item_id (the RPC's lines carry no id).
    // unit_dollars is per-unit + deterministic; line_dollars = unit × the raw
    // line's qty — reproduces the RPC exactly and is robust to duplicate parts.
    const priceByCanon = new Map<number, { unit: number; vendor: string | null }>();
    const rpcLines = rpc && Array.isArray(rpc.lines) ? (rpc.lines as RpcLine[]) : [];
    for (const rl of rpcLines) {
      if (rl.canonical_item_id != null && rl.priced && rl.unit_dollars != null) {
        priceByCanon.set(Number(rl.canonical_item_id), { unit: Number(rl.unit_dollars), vendor: rl.best_vendor ?? null });
      }
    }
    const lines: BomEstLine[] = (linesByBom.get(b.id) ?? []).map((l) => {
      const qty = Number(l.qty) || 0;
      const matched = l.canonical_item_id != null;
      const price = matched ? priceByCanon.get(Number(l.canonical_item_id)) : undefined;
      const priced = !!price;
      return {
        id: l.id,
        part_name: l.part_name,
        qty,
        optional: !!l.optional,
        note: l.note,
        canonical_item_id: l.canonical_item_id,
        matched,
        priced,
        unit_dollars: priced ? price!.unit : null,
        line_dollars: priced ? Math.round(price!.unit * qty * 100) / 100 : null,
        best_vendor: priced ? price!.vendor : null,
      };
    });
    return {
      id: b.id,
      service_key: b.service_key,
      service_label: b.service_label,
      q2_category: b.q2_category,
      q3_work_type: b.q3_work_type,
      status: b.status,
      basis: b.basis,
      model: b.model,
      notes: b.notes,
      lines,
      // Prefer the RPC scalars; fall back to raw-line counts when the RPC is null.
      materials_cost_dollars: Number(rpc?.materials_cost_dollars) || 0,
      optional_cost_dollars: Number(rpc?.optional_cost_dollars) || 0,
      coverage_pct: Number(rpc?.coverage_pct) || 0,
      n_lines: rpc?.n_lines != null ? Number(rpc.n_lines) : lines.length,
      n_required: rpc?.n_required != null ? Number(rpc.n_required) : lines.filter((l) => !l.optional).length,
      n_priced: rpc?.n_priced != null ? Number(rpc.n_priced) : lines.filter((l) => l.priced).length,
    };
  }

  const cards = boms.map(toCard);
  const pending = cards.filter((c) => c.status === "pending");
  const approved = cards.filter((c) => c.status === "approved");

  // Group pending by q2_category (stable — boms already ordered by category).
  const groupMap = new Map<string, BomCard[]>();
  for (const c of pending) {
    const key = c.q2_category?.trim() || "Uncategorized";
    const arr = groupMap.get(key);
    if (arr) arr.push(c); else groupMap.set(key, [c]);
  }
  const pendingGroups: CategoryGroup[] = [...groupMap.entries()].map(([category, b]) => ({ category, boms: b }));

  // Catalog demand: distinct services per unmatched part_name.
  const demandMap = new Map<string, { display: string; boms: Set<string>; lines: number }>();
  for (const r of (demandRes.data ?? []) as Array<{ part_name: string; bom_id: string }>) {
    const raw = (r.part_name ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    let e = demandMap.get(key);
    if (!e) { e = { display: raw, boms: new Set(), lines: 0 }; demandMap.set(key, e); }
    e.boms.add(r.bom_id);
    e.lines += 1;
  }
  const demand: DemandRow[] = [...demandMap.values()]
    .map((e) => ({ part_name: e.display, service_count: e.boms.size, line_count: e.lines }))
    .sort((a, b) => b.service_count - a.service_count || b.line_count - a.line_count)
    .slice(0, 24);

  const stats = {
    approved: approved.length,
    pending: pending.length,
    priced: cards.filter((c) => c.n_priced > 0).length,
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <BomReviewPanel
        pendingGroups={pendingGroups}
        approved={approved}
        demand={demand}
        stats={stats}
        loadError={loadError}
      />
    </main>
  );
}
