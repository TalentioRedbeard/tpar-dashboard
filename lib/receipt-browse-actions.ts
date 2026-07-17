"use server";

// Receipts browser (gallery-framework spec §8 Phase 1): Madisson's "verify
// everything is comprehensively accounted for" surface. Reads receipts_master
// DIRECTLY (the union RPC arrives in Phase 2; this action's facet shape is the
// contract the RPC will slot behind). Office-only — same admin+manager gate as
// every receipt surface (techs never reach receipt financials).
//
// Facet notes from the §9 audits (2026-07-17):
// - Person (tech_name) is SPARSE on batch sources: email/locke/winnelson are
//   ~100% NULL, credit_card ~33% NULL — the UI labels coverage honestly.
// - Only dashboard + slack_photo rows carry photos (262 of ~1,550) — the
//   browser is a LEDGER first, thumbnails where they exist.
// - amount is NUMERIC dollars in this table (pre-*_cents-era; comparisons stay
//   in dollars here — no unit conversion at this boundary).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type ReceiptFacets = {
  q?: string;               // vendor / notes text
  dateFrom?: string;        // YYYY-MM-DD (transaction_date)
  dateTo?: string;
  category?: "all" | "job" | "unattributed" | "gas" | "tools" | "office" | "dining" | "other";
  purchaser?: string;       // receipts_master.tech_name exact
  source?: string;
  amountMin?: number;       // dollars
  amountMax?: number;
  invoice?: string;         // job / invoice #
  customerId?: string;      // entity-expanded → jobs_master.hcp_invoice_number fan-out
  offset?: number;
};

export type BrowseReceipt = {
  id: number;
  vendor: string | null;
  amount: number;
  transaction_date: string | null;
  source: string | null;
  tech_name: string | null;
  purchaser_set_by: string | null;
  photo_url: string | null;
  invoice_number: string | null;
  is_overhead: boolean | null;
  overhead_category: string | null;
  notes: string | null;
};

export type BrowseResult =
  | {
      ok: true;
      rows: BrowseReceipt[];
      totalCount: number;
      totalAmount: number;   // dollars, across the WHOLE filtered set (not the page)
      pageSize: number;
      offset: number;
    }
  | { ok: false; error: string };

const PAGE = 48;
const clean = (s: string) => s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();

export async function searchReceipts(facets: ReceiptFacets): Promise<BrowseResult> {
  const me = await getCurrentTech().catch(() => null);
  if (!me || (!me.isAdmin && !me.isManager)) return { ok: false, error: "unauthorized" };
  const supa = db();

  // Customer facet: entity-expand (tethering law), then fan out to the
  // entity's job invoice numbers. jobs_master's column is hcp_invoice_number.
  let invoiceSet: string[] | null = null;
  if (facets.customerId?.trim()) {
    const { data: members } = await supa.rpc("customer_entity_members", { p_seed: facets.customerId.trim() });
    const cids = ((members ?? []) as Array<{ member_cid: string }>).map((r) => r.member_cid).filter(Boolean);
    const ids = cids.length ? cids : [facets.customerId.trim()];
    const { data: jobs } = await supa
      .from("jobs_master")
      .select("hcp_invoice_number")
      .in("hcp_customer_id", ids)
      .not("hcp_invoice_number", "is", null)
      .limit(1000);
    invoiceSet = [...new Set(((jobs ?? []) as Array<{ hcp_invoice_number: string | null }>)
      .map((j) => (j.hcp_invoice_number ?? "").trim()).filter(Boolean))];
    if (invoiceSet.length === 0) {
      return { ok: true, rows: [], totalCount: 0, totalAmount: 0, pageSize: PAGE, offset: 0 };
    }
  }

  const apply = <T,>(q: T): T => {
    // deno-lint-ignore no-explicit-any
    let x = q as any;
    const text = clean(facets.q ?? "");
    if (text) x = x.or(`vendor_description.ilike.%${text}%,notes.ilike.%${text}%,raw_po.ilike.%${text}%`);
    if (facets.dateFrom) x = x.gte("transaction_date", facets.dateFrom);
    if (facets.dateTo) x = x.lte("transaction_date", facets.dateTo);
    const cat = facets.category ?? "all";
    if (cat === "job") x = x.not("invoice_number", "is", null).neq("invoice_number", "");
    else if (cat === "unattributed") x = x.or("invoice_number.is.null,invoice_number.eq.").not("is_overhead", "is", true);
    else if (cat !== "all") x = x.eq("overhead_category", cat);
    if (facets.purchaser?.trim()) x = x.eq("tech_name", facets.purchaser.trim());
    if (facets.source?.trim()) x = x.eq("source", facets.source.trim());
    if (typeof facets.amountMin === "number" && Number.isFinite(facets.amountMin)) x = x.gte("amount", facets.amountMin);
    if (typeof facets.amountMax === "number" && Number.isFinite(facets.amountMax)) x = x.lte("amount", facets.amountMax);
    if (facets.invoice?.trim()) x = x.eq("invoice_number", facets.invoice.trim());
    if (invoiceSet) x = x.in("invoice_number", invoiceSet.slice(0, 500));
    return x as T;
  };

  const offset = Math.max(0, Number(facets.offset ?? 0));
  const pageRes = await apply(
    supa.from("receipts_master")
      .select("id, vendor_description, amount, transaction_date, source, tech_name, purchaser_set_by, photo_url, invoice_number, is_overhead, overhead_category, notes", { count: "exact" }),
  )
    .order("transaction_date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE - 1);
  if (pageRes.error) return { ok: false, error: pageRes.error.message };

  // Whole-set total. PostgREST caps any single response at ~1000 rows
  // regardless of .limit() (the bug the first probe caught: $45.8k rendered
  // against a $577k truth) — so page the amounts explicitly, id-ordered.
  let totalAmount = 0;
  {
    const CHUNK = 1000;
    let lastId = -1;
    for (let i = 0; i < 12; i++) {
      const { data: chunk, error: sumErr } = await apply(
        supa.from("receipts_master").select("id, amount"),
      )
        .gt("id", lastId)
        .order("id", { ascending: true })
        .limit(CHUNK);
      if (sumErr) return { ok: false, error: sumErr.message };
      const rows = (chunk ?? []) as Array<{ id: number; amount: unknown }>;
      for (const r of rows) totalAmount += Number(r.amount) || 0;
      if (rows.length < CHUNK) break;
      lastId = rows[rows.length - 1].id;
    }
  }

  const rows: BrowseReceipt[] = ((pageRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as number,
    vendor: (r.vendor_description as string | null) ?? null,
    amount: Number(r.amount) || 0,
    transaction_date: (r.transaction_date as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    tech_name: (r.tech_name as string | null) ?? null,
    purchaser_set_by: (r.purchaser_set_by as string | null) ?? null,
    photo_url: (r.photo_url as string | null) ?? null,
    invoice_number: (r.invoice_number as string | null) ?? null,
    is_overhead: (r.is_overhead as boolean | null) ?? null,
    overhead_category: (r.overhead_category as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }));
  return {
    ok: true,
    rows,
    totalCount: pageRes.count ?? rows.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    pageSize: PAGE,
    offset,
  };
}
