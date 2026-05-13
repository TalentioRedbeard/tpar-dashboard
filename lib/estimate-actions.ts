// Server action: push a multi-option estimate to HCP via the existing
// create-estimate-direct edge function. Used by /job/[id]/estimate/new.
//
// Auth: any signed-in user on the allowlist (server actions inherit
// middleware enforcement). Author email captured for audit.

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriter } from "./current-tech";
import { db } from "./supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SECRET = process.env.CREATE_ESTIMATE_DIRECT_SECRET ?? "";
const GENERATE_DESCRIPTION_SECRET = process.env.GENERATE_DESCRIPTION_SECRET ?? "";

type LineItemInput = {
  name: string;
  description?: string;
  unit_price_cents: number;
  unit_cost_cents?: number;
  quantity: number;
};

type OptionInput = { name: string; line_items: LineItemInput[] };

export type EstimateResult =
  | { ok: true; estimate_id: string; estimate_number: string; hcp_url: string | null }
  | { ok: false; error: string };

export async function createEstimateForJob(formData: FormData): Promise<EstimateResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !SECRET) return { ok: false, error: "server config missing" };

  const hcpJobId = String(formData.get("hcp_job_id") ?? "").trim();
  const note     = String(formData.get("note") ?? "").trim();
  const message  = String(formData.get("message") ?? "").trim();
  if (!hcpJobId) return { ok: false, error: "hcp_job_id required" };

  // Pull customer from job_360. address_id isn't on job_360 (HCP picks the
  // default customer address); pass it through only if a future caller
  // ever provides it on the form.
  const supa = db();
  const { data: job, error: jobErr } = await supa
    .from("job_360")
    .select("hcp_customer_id")
    .eq("hcp_job_id", hcpJobId)
    .maybeSingle();
  if (jobErr || !job) return { ok: false, error: `job lookup: ${jobErr?.message ?? "not found"}` };
  const hcpCustomerId = job.hcp_customer_id as string | null;
  if (!hcpCustomerId) return { ok: false, error: "job has no hcp_customer_id" };

  // Form encodes options + line items as repeating fields:
  //   options[0][name]
  //   options[0][line_items][0][name]
  //   options[0][line_items][0][quantity]
  //   options[0][line_items][0][unit_price] (dollars; we convert)
  //   options[0][line_items][0][description]
  //   options[1][name] ...etc
  // We parse from FormData entries.

  const optionMap = new Map<number, OptionInput>();
  for (const [key, raw] of formData.entries()) {
    const m = key.match(/^options\[(\d+)\]\[(name|line_items)\](?:\[(\d+)\]\[(name|description|quantity|unit_price|unit_cost)\])?$/);
    if (!m) continue;
    const optIdx = Number(m[1]);
    if (!optionMap.has(optIdx)) optionMap.set(optIdx, { name: "", line_items: [] });
    const opt = optionMap.get(optIdx)!;
    if (m[2] === "name" && !m[3]) {
      opt.name = String(raw).trim();
    } else if (m[2] === "line_items" && m[3] !== undefined) {
      const liIdx = Number(m[3]);
      while (opt.line_items.length <= liIdx) opt.line_items.push({ name: "", quantity: 1, unit_price_cents: 0 });
      const li = opt.line_items[liIdx];
      const v = String(raw).trim();
      switch (m[4]) {
        case "name":        li.name = v; break;
        case "description": li.description = v || undefined; break;
        case "quantity":    li.quantity = Number(v) || 1; break;
        case "unit_price":  li.unit_price_cents = Math.round((Number(v) || 0) * 100); break;
        case "unit_cost":   li.unit_cost_cents = v === "" ? undefined : Math.round((Number(v) || 0) * 100); break;
      }
    }
  }

  // Sort + filter. Allow $0 unit_price so techs can push descriptive options
  // first and fill prices in HCP (or back here) after — field workflow
  // requirement, Danny 2026-05-13.
  let options = [...optionMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, o]) => ({
      name: o.name || "Option",
      line_items: o.line_items.filter((li) => li.name && li.quantity > 0),
    }))
    .filter((o) => o.line_items.length > 0);

  // Optional scoping — push a single option (or subset). UI sends a
  // comma-separated list of option indices in the original form ordering.
  // Used by the per-option "Push this option" button so techs can push
  // Phase 1 today, Phase 2 later (matches the diagnostic-work flow Danny
  // articulated 2026-05-05).
  const scopeRaw = String(formData.get("option_indices") ?? "").trim();
  if (scopeRaw) {
    const wantIdx = new Set(
      scopeRaw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0),
    );
    // Map after the same sort+filter the parser did — option_indices refer to
    // the original optionMap key (form's optIdx). The .sort by key preserves
    // that ordering, but filter may have dropped empties; so we re-resolve
    // against the still-present indices.
    const presentIdx = [...optionMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([k]) => k);
    options = options.filter((_, i) => wantIdx.has(presentIdx[i]));
    if (options.length === 0) {
      return { ok: false, error: "Selected option(s) had no valid line items." };
    }
  }

  if (options.length === 0) {
    return { ok: false, error: "Add at least one option with at least one line item (name + quantity)." };
  }

  const body: Record<string, unknown> = {
    hcp_customer_id: hcpCustomerId,
    options,
  };
  if (note) body.note = note.slice(0, 8000);
  if (message) body.message = message.slice(0, 8000);

  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-estimate-direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trigger-Secret": SECRET },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `HCP push failed: ${r.status} ${text.slice(0, 400)}` };

  let parsed: { ok?: boolean; error?: string; estimate_id?: string; estimate_number?: string; hcp_url?: string | null };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "create-estimate-direct returned ok=false" };

  // Audit
  await supa.from("maintenance_logs").insert({
    source: "dashboard-estimate-create",
    level: "info",
    message: `estimate pushed from dashboard`,
    context: {
      hcp_job_id: hcpJobId,
      hcp_customer_id: hcpCustomerId,
      author_email: writer.email,
      estimate_id: parsed.estimate_id,
      estimate_number: parsed.estimate_number,
      option_count: options.length,
      line_count: options.reduce((n, o) => n + o.line_items.length, 0),
    },
  });

  revalidatePath(`/job/${hcpJobId}`);

  return {
    ok: true,
    estimate_id: parsed.estimate_id ?? "",
    estimate_number: parsed.estimate_number ?? "",
    hcp_url: parsed.hcp_url ?? null,
  };
}

export type SendResult =
  | { ok: true; sent_at: string | null; sent_to: string | null; sent_method: string | null }
  | { ok: false; error: string };

export async function sendEstimateToClient(formData: FormData): Promise<SendResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !SECRET) return { ok: false, error: "server config missing" };

  const estimateId = String(formData.get("estimate_id") ?? "").trim();
  const message    = String(formData.get("message") ?? "").trim();
  if (!estimateId) return { ok: false, error: "estimate_id required" };

  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-estimate-direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trigger-Secret": SECRET },
    body: JSON.stringify({
      op: "send_to_customer",
      estimate_id: estimateId,
      ...(message ? { message } : {}),
    }),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `HCP send failed: ${r.status} ${text.slice(0, 400)}` };

  let parsed: { ok?: boolean; error?: string; sent_at?: string; sent_to?: string; sent_method?: string };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "send returned ok=false" };

  // Audit
  const supa = db();
  await supa.from("maintenance_logs").insert({
    source: "dashboard-estimate-send",
    level: "info",
    message: `estimate sent to customer from dashboard`,
    context: {
      estimate_id: estimateId,
      author_email: writer.email,
      sent_at: parsed.sent_at ?? null,
      sent_to: parsed.sent_to ?? null,
      sent_method: parsed.sent_method ?? null,
    },
  });

  return {
    ok: true,
    sent_at: parsed.sent_at ?? null,
    sent_to: parsed.sent_to ?? null,
    sent_method: parsed.sent_method ?? null,
  };
}

// ── Price lookup — mirrors slack-price's QR-then-price_book search, in JS.
// Returns up to 3 matches sorted by trigram similarity.

export type PriceMatch = {
  source: "pricing_quick_reference" | "price_book";
  id: number;
  item_name: string;
  price_low: number | null;        // QR low end / PB sell_price
  price_high: number | null;       // QR high end only
  pricing_method: string | null;   // PB only
  category: string | null;
  task_code: string | null;        // PB only
  pending_review_note: string | null;
  similarity: number;
};

export type PriceLookupResult =
  | { ok: true; matches: PriceMatch[] }
  | { ok: false; error: string };

function jsTrigramSim(a: string, b: string): number {
  const trig = (s: string): Set<string> => {
    const p = `  ${s.toLowerCase().trim()} `;
    const out = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const A = trig(a);
  const B = trig(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const PRICE_SIMILARITY_THRESHOLD = 0.25;

export async function lookupPriceForScope(query: string): Promise<PriceLookupResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  const q = query.trim();
  if (!q) return { ok: false, error: "Type something to look up." };

  const supa = db();

  // 1) pricing_quick_reference — small table, fetch all active rows + score in JS
  const { data: qrRows, error: qrErr } = await supa
    .from("pricing_quick_reference")
    .select("id,item_name,price_low,price_high,price_note,category,pending_review_note")
    .eq("active", true);
  if (qrErr) return { ok: false, error: `quick_ref: ${qrErr.message}` };

  const qrScored: PriceMatch[] = (qrRows ?? []).map((r) => ({
    source: "pricing_quick_reference" as const,
    id: r.id as number,
    item_name: r.item_name as string,
    price_low: r.price_low === null ? null : Number(r.price_low),
    price_high: r.price_high === null ? null : Number(r.price_high),
    pricing_method: null,
    category: r.category as string | null,
    task_code: null,
    pending_review_note: r.pending_review_note as string | null,
    similarity: jsTrigramSim(q, r.item_name as string),
  }));

  // 2) price_book — too large to load fully, ILIKE-filter on tokens then score in JS
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  let pbScored: PriceMatch[] = [];
  if (tokens.length > 0) {
    const orExpr = tokens.map((t) => `item_name.ilike.%${t}%`).join(",");
    const { data: pbRows, error: pbErr } = await supa
      .from("price_book")
      .select("id,item_name,sell_price,pricing_method,category,task_code,pending_review_note")
      .eq("active", true)
      .or(orExpr)
      .limit(50);
    if (pbErr) return { ok: false, error: `price_book: ${pbErr.message}` };
    pbScored = (pbRows ?? []).map((r) => ({
      source: "price_book" as const,
      id: r.id as number,
      item_name: r.item_name as string,
      price_low: r.sell_price === null ? null : Number(r.sell_price),
      price_high: null,
      pricing_method: r.pricing_method as string | null,
      category: r.category as string | null,
      task_code: r.task_code as string | null,
      pending_review_note: r.pending_review_note as string | null,
      similarity: jsTrigramSim(q, r.item_name as string),
    }));
  }

  const matches = [...qrScored, ...pbScored]
    .filter((m) => m.similarity >= PRICE_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);

  return { ok: true, matches };
}

export type GenerateDescriptionResult =
  | { ok: true; description: string }
  | { ok: false; error: string };

/**
 * Calls Claude Haiku via the generate-description edge function to produce
 * a customer-facing line-item scope paragraph in Danny's voice. Used by
 * the EstimateBuilder "✨ Generate" button next to each description.
 */
export async function generateLineDescription(formData: FormData): Promise<GenerateDescriptionResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !GENERATE_DESCRIPTION_SECRET) {
    return { ok: false, error: "server config missing" };
  }

  const scope    = String(formData.get("scope") ?? "").trim();
  const lineName = String(formData.get("line_item_name") ?? "").trim();
  if (!scope) return { ok: false, error: "scope is required" };

  const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-description`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Trigger-Secret": GENERATE_DESCRIPTION_SECRET,
    },
    body: JSON.stringify({
      scope,
      ...(lineName ? { line_item_name: lineName } : {}),
    }),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `generate failed: ${r.status} ${text.slice(0, 200)}` };

  let parsed: { ok?: boolean; error?: string; description?: string };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "generate returned ok=false" };

  return { ok: true, description: parsed.description ?? "" };
}
