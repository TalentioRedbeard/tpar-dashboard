"use server";

// Public hosted-estimate-view server actions. NO auth gate here on purpose —
// the TOKEN is the entire auth boundary (middleware exempts /e). Every read uses
// the service-role db() and is whitelisted down to PublicOption[]: NO cost,
// margin, unit_cost, AI reasoning, reprice/BLOCK flags, or internal IDs ever
// leave the server. Unknown / expired / revoked tokens resolve to null so the
// page renders a neutral "link no longer active" message and never reveals
// whether a token exists.
//
// MONEY LANDMINE: HCP option totals (hcp_estimates_raw.raw->options[].total_amount)
// are CENTS; bid_estimate_lines.line_sell_price is DOLLARS. Both are normalized to
// a single dollars field on PublicOption HERE, at the server boundary, so the
// render component never has to know which source it came from.

import { db } from "@/lib/supabase";
import { headers } from "next/headers";

// A single customer-facing scope line within an option. Internal-field-free.
export type PublicLine = {
  name: string;
  description: string | null;
  quantity: number | null;
};

// One option, normalized across AI-built (line items, DOLLARS) and HCP-native
// (name + total + prose only, CENTS÷100) sources.
export type PublicOption = {
  name: string;
  total_dollars: number | null;
  // Itemized scope (AI-built estimates only); empty for HCP-native.
  lines: PublicLine[];
  // Customer-facing prose: bid notes, or the HCP option's notes content.
  description: string | null;
};

export type PublicEstimate = {
  customerName: string | null;
  estimateNumber: string | null;
  options: PublicOption[];
  // The single dedup'd terms/legal block (HCP message_from_pro), if present.
  termsText: string | null;
};

type ResolveResult =
  | { ok: true; sendId: number; estimate: PublicEstimate }
  | { ok: false };

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Resolve a hosted-view token to a whitelisted, internal-field-free estimate.
// Returns { ok:false } for any unknown/expired/revoked token (constant shape).
export async function resolveEstimateByToken(token: string): Promise<ResolveResult> {
  const t = (token ?? "").trim();
  if (!t) return { ok: false };

  const supa = db();

  // 1) The send row IS the gate (existence + expiry + revocation).
  const { data: send } = await supa
    .from("estimate_sends")
    .select("id, hcp_estimate_id, status, expires_at, revoked_at")
    .eq("token", t)
    .maybeSingle();
  if (!send) return { ok: false };
  if (send.revoked_at) return { ok: false };
  if (send.expires_at && new Date(send.expires_at as string).getTime() < Date.now()) return { ok: false };

  const hcpEstimateId = send.hcp_estimate_id as string;

  // 2) Pipeline row for headline display (customer_name, estimate_number,
  //    bid_estimate_id for the AI-built itemized path).
  const { data: pipe } = await supa
    .from("estimate_pipeline_v")
    .select("customer_name, estimate_number, bid_estimate_id")
    .eq("hcp_estimate_id", hcpEstimateId)
    .maybeSingle();

  // 3) Raw options (HCP-native source: name + total_amount CENTS + notes + message_from_pro).
  const { data: rawRow } = await supa
    .from("hcp_estimates_raw")
    .select("raw")
    .eq("hcp_estimate_id", hcpEstimateId)
    .maybeSingle();

  const raw = (rawRow?.raw ?? {}) as Record<string, unknown>;
  const rawOptions = Array.isArray(raw["options"]) ? (raw["options"] as Array<Record<string, unknown>>) : [];

  // Dedup the terms/legal prose (message_from_pro is identical boilerplate per option).
  let termsText: string | null = null;
  for (const o of rawOptions) {
    const mfp = typeof o["message_from_pro"] === "string" ? o["message_from_pro"].trim() : "";
    if (mfp) { termsText = mfp; break; }
  }

  // 4) AI-built itemized scope (DOLLARS), if this estimate is bid-linked.
  const bidEstimateId = pipe?.bid_estimate_id ?? null;
  const linesByOption = new Map<string, PublicLine[]>();
  const optionOrder: string[] = [];
  const optionSubtotal = new Map<string, number>();
  if (bidEstimateId) {
    const { data: bidLines } = await supa
      .from("bid_estimate_lines")
      // WHITELIST: only customer-safe columns. NEVER select unit_cost,
      // materials_cost_internal, modifier_total, matched_from, intake, etc.
      .select("option_label, item_name, description, quantity, line_sell_price, sort_order")
      .eq("estimate_id", bidEstimateId)
      .order("option_label", { ascending: true })
      .order("sort_order", { ascending: true });
    for (const l of (bidLines ?? []) as Array<Record<string, unknown>>) {
      const label = (l["option_label"] as string | null) ?? "";
      if (!linesByOption.has(label)) { linesByOption.set(label, []); optionOrder.push(label); optionSubtotal.set(label, 0); }
      linesByOption.get(label)!.push({
        name: (l["item_name"] as string | null) ?? "",
        description: (l["description"] as string | null) ?? null,
        quantity: num(l["quantity"]),
      });
      optionSubtotal.set(label, (optionSubtotal.get(label) ?? 0) + (num(l["line_sell_price"]) ?? 0));
    }
  }

  // 5) Build the normalized option list. Prefer the HCP option ordering (the
  //    good/better/best the customer was quoted); attach AI line items + subtotal
  //    by index when present (AI estimates and HCP options align 1:1).
  let options: PublicOption[] = [];
  if (rawOptions.length > 0) {
    options = rawOptions.map((o, i) => {
      const aiLabel = optionOrder[i];
      const aiLines = aiLabel != null ? (linesByOption.get(aiLabel) ?? []) : [];
      const cents = num(o["total_amount"]);
      const aiSubtotal = aiLabel != null ? optionSubtotal.get(aiLabel) : undefined;
      const notes = Array.isArray(o["notes"]) ? (o["notes"] as Array<Record<string, unknown>>) : [];
      const noteText = notes.map((n) => (typeof n["content"] === "string" ? n["content"] : "")).filter(Boolean).join("\n\n") || null;
      return {
        name: (o["name"] as string | null) ?? `Option ${i + 1}`,
        // HCP total is CENTS → dollars; fall back to the AI subtotal (already DOLLARS).
        total_dollars: cents != null ? Math.round(cents / 100) : (aiSubtotal != null ? Math.round(aiSubtotal) : null),
        lines: aiLines,
        description: noteText,
      };
    });
  } else if (linesByOption.size > 0) {
    // No HCP options on the raw record but an AI bid exists — render from it.
    options = optionOrder.map((label, i) => ({
      name: `Option ${String.fromCharCode(65 + i)}`,
      total_dollars: Math.round(optionSubtotal.get(label) ?? 0),
      lines: linesByOption.get(label) ?? [],
      description: null,
    }));
  }

  return {
    ok: true,
    sendId: send.id as number,
    estimate: {
      customerName: (pipe?.customer_name as string | null) ?? null,
      estimateNumber: (pipe?.estimate_number as string | null) ?? null,
      options,
      termsText,
    },
  };
}

// Log a hosted-page view via the RLS-locked record_estimate_view RPC. Pulls ip/ua
// from the request headers. Best-effort — a logging failure must NEVER block the
// page render (caller wraps in try/catch too).
export async function logEstimateView(sendId: number): Promise<void> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 100) || null;
    const ua = (h.get("user-agent") ?? "").slice(0, 500) || null;
    await db().rpc("record_estimate_view", { p_send_id: sendId, p_ip: ip, p_ua: ua });
  } catch {
    /* never blocks render */
  }
}
