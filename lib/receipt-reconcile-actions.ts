"use server";

// Receipt reconciliation (#2, 2026-06-18). The office (admin + manager) triages
// unattributed receipts — ~681 receipts / ~$431k of material spend with no invoice_number,
// invisible to job cost (email supplier invoices dominate at ~$409k). Each can be ATTACHED
// to a job's invoice trunk (flows into job_cost_v1 receipts_agg) or marked OVERHEAD (truck
// stock / shop / gas). Auto-suggest matches the submitting tech + date to jobs; manual attach
// reuses the entity/project search (search_work_projects).
//
// Access: admin + manager (reconciliation is Madisson's operational job — same scoped
// carve-out as receipt logging; managers stay read-only for note authorship elsewhere).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

async function requireReconciler() {
  const me = await getCurrentTech().catch(() => null);
  if (!me || (!me.isAdmin && !me.isManager)) return null;
  return me;
}

export type ReconcileLineItem = { description?: string; quantity?: number; unit_price?: number; line_total?: number };
export type UnlinkedReceipt = {
  id: number;
  vendor: string | null;
  amount: number;
  transaction_date: string | null;
  source: string | null;
  tech_name: string | null;
  photo_url: string | null;
  notes: string | null;
  raw_po: string | null;
  line_items: ReconcileLineItem[];
  has_tech: boolean;
};

export type UnlinkedSummary = { count: number; total: number; emailCount: number; emailTotal: number };

export async function getUnlinkedReceipts(opts?: { source?: string; limit?: number }): Promise<{ rows: UnlinkedReceipt[]; summary: UnlinkedSummary } | { error: string }> {
  const me = await requireReconciler();
  if (!me) return { error: "unauthorized" };
  const supa = db();
  const limit = Math.min(opts?.limit ?? 60, 200);

  let q = supa
    .from("receipts_master")
    .select("id, vendor_description, amount, transaction_date, source, tech_name, photo_url, notes, raw_po")
    .or("invoice_number.is.null,invoice_number.eq.")
    .not("is_overhead", "is", true)
    .order("transaction_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (opts?.source) q = q.eq("source", opts.source);
  const { data } = await q;
  const base = (data ?? []) as Array<Record<string, unknown>>;

  // line-item preview from receipt_extractions (decision aid, esp. for photo-less email invoices)
  const ids = base.map((r) => r.id as number);
  const exMap = new Map<number, ReconcileLineItem[]>();
  if (ids.length) {
    const { data: ex } = await supa.from("receipt_extractions").select("receipt_id, line_items").in("receipt_id", ids);
    for (const e of (ex ?? []) as Array<{ receipt_id: number; line_items: unknown }>) {
      if (Array.isArray(e.line_items)) exMap.set(e.receipt_id, e.line_items as ReconcileLineItem[]);
    }
  }

  const rows: UnlinkedReceipt[] = base.map((r) => ({
    id: r.id as number,
    vendor: (r.vendor_description as string | null) ?? null,
    amount: Number(r.amount) || 0,
    transaction_date: (r.transaction_date as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    tech_name: (r.tech_name as string | null) ?? null,
    photo_url: (r.photo_url as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    raw_po: (r.raw_po as string | null) ?? null,
    line_items: (exMap.get(r.id as number) ?? []).slice(0, 8),
    has_tech: !!(r.tech_name as string | null),
  }));

  // summary across the WHOLE unlinked-not-overhead set (not just this page)
  const { data: allRows } = await supa
    .from("receipts_master")
    .select("amount, source")
    .or("invoice_number.is.null,invoice_number.eq.")
    .not("is_overhead", "is", true)
    .limit(5000);
  const all = (allRows ?? []) as Array<{ amount: number; source: string | null }>;
  const summary: UnlinkedSummary = {
    count: all.length,
    total: all.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    emailCount: all.filter((r) => r.source === "email").length,
    emailTotal: all.filter((r) => r.source === "email").reduce((s, r) => s + (Number(r.amount) || 0), 0),
  };
  return { rows, summary };
}

export type ReceiptJobSuggestion = { trunk: string; hcpJobId: string | null; customerName: string | null; jobDate: string | null; dayGap: number };

export async function suggestForReceipt(receiptId: number): Promise<ReceiptJobSuggestion[]> {
  const me = await requireReconciler();
  if (!me) return [];
  const { data } = await db().rpc("suggest_jobs_for_receipt", { p_receipt_id: receiptId, p_lim: 5 });
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    trunk: r.trunk as string,
    hcpJobId: (r.hcp_job_id as string | null) ?? null,
    customerName: (r.customer_name as string | null) ?? null,
    jobDate: r.job_date ? String(r.job_date).slice(0, 10) : null,
    dayGap: Number(r.day_gap) || 0,
  })).filter((r) => r.trunk);
}

export type ReceiptProjectMatch = { trunk: string; customerName: string | null; jobCount: number; lastDate: string | null };

// Manual attach picker — reuse the entity/project search (P5) so the office can find any
// customer/job/estimate and attach the receipt to that project's invoice trunk.
export async function searchProjectsForReceipt(q: string): Promise<ReceiptProjectMatch[]> {
  const me = await requireReconciler();
  if (!me) return [];
  const safe = q.trim();
  if (safe.length < 2) return [];
  const { data } = await db().rpc("search_work_projects", { q: safe, lim: 20 });
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    trunk: r.trunk as string,
    customerName: (r.customer_name as string | null) ?? null,
    jobCount: Number(r.job_count) || 0,
    lastDate: r.last_date ? String(r.last_date).slice(0, 10) : null,
  })).filter((r) => r.trunk);
}

export async function attachReceiptToJob(receiptId: number, trunk: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireReconciler();
  if (!me) return { ok: false, error: "unauthorized" };
  const t = String(trunk ?? "").trim();
  if (!/^\d{6,}(-\d+)?$/.test(t)) return { ok: false, error: "invalid invoice/job number" };
  const { error } = await db().from("receipts_master").update({ invoice_number: t.split("-")[0], is_overhead: false }).eq("id", receiptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports/receipts");
  return { ok: true };
}

export async function markReceiptsOverhead(receiptIds: number[]): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  const me = await requireReconciler();
  if (!me) return { ok: false, error: "unauthorized" };
  const ids = (receiptIds ?? []).filter((n) => Number.isFinite(n)).slice(0, 500);
  if (!ids.length) return { ok: false, error: "no receipts selected" };
  const { error } = await db().from("receipts_master").update({ is_overhead: true }).in("id", ids);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports/receipts");
  return { ok: true, n: ids.length };
}
