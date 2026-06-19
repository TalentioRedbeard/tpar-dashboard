"use server";

// Parts bid / RFQ flow (2026-06-18). Create a bid request from selected needs/parts + urgency +
// suppliers; the email itself goes out via mailto (client) on the existing rails. Bids logged
// back here to compare on price + delivery and award. Leadership-only (purchasing decision).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

async function gate() {
  const me = await getCurrentTech().catch(() => null);
  return me && (me.isAdmin || me.isManager) ? me : null;
}

export type RfqLine = { qty: number | null; item: string; need_id?: string | null; canonical_item_id?: number | null };
export type RfqSupplier = { distributor_id: string | null; name: string; order_email: string | null };
export type RfqBid = {
  id: number; distributor: string; total_cents: number | null; delivery_days: number | null;
  delivery_fee_cents: number | null; free_delivery: boolean | null; notes: string | null;
  status: string; created_at: string;
};
export type Rfq = {
  id: number; title: string | null; urgency: string; note: string | null; status: string;
  lines: RfqLine[]; suppliers: RfqSupplier[]; awarded_distributor: string | null;
  created_by: string | null; created_at: string; bids: RfqBid[];
};

const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

export type SupplierTarget = { id: string; name: string; order_email: string | null };

export async function listSupplierTargets(): Promise<SupplierTarget[]> {
  const me = await gate();
  if (!me) return [];
  const { data } = await db().from("distributors")
    .select("id, name, order_email, email, is_active, sort_order")
    .eq("is_active", true).order("sort_order", { ascending: true, nullsFirst: false }).order("name");
  return ((data ?? []) as Array<Record<string, unknown>>).map((d) => ({
    id: d.id as string, name: (d.name as string) ?? "",
    order_email: ((d.order_email as string | null) || (d.email as string | null)) ?? null,
  }));
}

export async function createRfq(input: {
  title?: string; urgency: string; note?: string;
  lines: RfqLine[]; supplierIds: string[];
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const me = await gate();
  if (!me) return { ok: false, error: "unauthorized" };
  const lines = (input.lines ?? []).filter((l) => (l.item ?? "").trim().length > 0).slice(0, 100);
  if (!lines.length) return { ok: false, error: "add at least one part" };

  // Resolve chosen suppliers from the distributor directory.
  let suppliers: RfqSupplier[] = [];
  const ids = (input.supplierIds ?? []).filter(Boolean);
  if (ids.length) {
    const { data } = await db().from("distributors").select("id, name, order_email, email").in("id", ids);
    suppliers = (data ?? []).map((d: Record<string, unknown>) => ({
      distributor_id: d.id as string,
      name: (d.name as string) ?? "",
      order_email: ((d.order_email as string | null) || (d.email as string | null)) ?? null,
    }));
  }

  const { data, error } = await db().from("part_rfqs").insert({
    title: input.title?.trim() || null,
    urgency: input.urgency || "this_week",
    note: input.note?.trim() || null,
    lines, suppliers,
    created_by: me.email,
  }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "create failed" };
  revalidatePath("/shopping/rfq");
  return { ok: true, id: data.id as number };
}

export async function listRfqs(): Promise<Rfq[]> {
  const me = await gate();
  if (!me) return [];
  const { data } = await db().from("part_rfqs").select("*").order("created_at", { ascending: false }).limit(40);
  const rfqs = (data ?? []) as Array<Record<string, unknown>>;
  const ids = rfqs.map((r) => r.id as number);
  const bidsByRfq = new Map<number, RfqBid[]>();
  if (ids.length) {
    const { data: bids } = await db().from("part_rfq_bids").select("*").in("rfq_id", ids).order("total_cents", { ascending: true, nullsFirst: false });
    for (const b of (bids ?? []) as Array<Record<string, unknown>>) {
      const arr = bidsByRfq.get(b.rfq_id as number) ?? [];
      arr.push({
        id: b.id as number, distributor: b.distributor as string, total_cents: n(b.total_cents),
        delivery_days: n(b.delivery_days), delivery_fee_cents: n(b.delivery_fee_cents),
        free_delivery: (b.free_delivery as boolean | null) ?? null, notes: (b.notes as string | null) ?? null,
        status: b.status as string, created_at: b.created_at as string,
      });
      bidsByRfq.set(b.rfq_id as number, arr);
    }
  }
  return rfqs.map((r) => ({
    id: r.id as number, title: (r.title as string | null) ?? null, urgency: r.urgency as string,
    note: (r.note as string | null) ?? null, status: r.status as string,
    lines: Array.isArray(r.lines) ? (r.lines as RfqLine[]) : [],
    suppliers: Array.isArray(r.suppliers) ? (r.suppliers as RfqSupplier[]) : [],
    awarded_distributor: (r.awarded_distributor as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null, created_at: r.created_at as string,
    bids: bidsByRfq.get(r.id as number) ?? [],
  }));
}

export async function logBid(input: {
  rfqId: number; distributor: string; total_cents?: number | null; delivery_days?: number | null;
  delivery_fee_cents?: number | null; free_delivery?: boolean; notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await gate();
  if (!me) return { ok: false, error: "unauthorized" };
  if (!input.distributor?.trim()) return { ok: false, error: "which supplier?" };
  const { error } = await db().from("part_rfq_bids").insert({
    rfq_id: input.rfqId, distributor: input.distributor.trim(),
    total_cents: n(input.total_cents), delivery_days: n(input.delivery_days),
    delivery_fee_cents: n(input.delivery_fee_cents), free_delivery: input.free_delivery ?? null,
    notes: input.notes?.trim() || null, created_by: me.email,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping/rfq");
  return { ok: true };
}

export async function awardRfq(rfqId: number, bidId: number, distributor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await gate();
  if (!me) return { ok: false, error: "unauthorized" };
  const supa = db();
  const { error: e1 } = await supa.from("part_rfqs").update({ status: "awarded", awarded_distributor: distributor, awarded_at: new Date().toISOString() }).eq("id", rfqId);
  if (e1) return { ok: false, error: e1.message };
  await supa.from("part_rfq_bids").update({ status: "received" }).eq("rfq_id", rfqId);
  await supa.from("part_rfq_bids").update({ status: "awarded" }).eq("id", bidId);
  revalidatePath("/shopping/rfq");
  return { ok: true };
}

export async function closeRfq(rfqId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await gate();
  if (!me) return { ok: false, error: "unauthorized" };
  const { error } = await db().from("part_rfqs").update({ status: "closed" }).eq("id", rfqId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping/rfq");
  return { ok: true };
}
