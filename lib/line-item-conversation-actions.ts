"use server";

// Server actions for the "Price it with me" conversation panel inside the
// multi-option estimate builder (components/PriceItWithMe). Thin, writer-gated
// bridges to the estimate-from-conversation edge fn (service-role lane — same
// pattern as sendBuilderEstimateTracked in multi-option-estimate-actions):
//
//   conversationExtract  → {mode:'extract'}  narration → scope items + judgment questions
//   conversationPropose  → {mode:'build', propose_only:true} → deterministic proposed lines
//
// All money is DOLLARS end-to-end (the panel converts to the builder's string
// fields; the builder itself converts to cents at push time). Parsing is
// deliberately TOLERANT — every field is defaulted so a minor contract
// deviation from the backend degrades gracefully instead of crashing the
// panel. Raw scope_items from extract are passed back verbatim on propose.

import { getCurrentTech, requireWriter } from "./current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// ── Shared types ─────────────────────────────────────────────────────────────

export type ConversationTurn = { speaker: "tech" | "system"; text: string };

// One extracted scope item, flattened for the chip row. groundingStatus is the
// backend's word ("matched"/"ambiguous"/"custom"/…). NOTE: "ambiguous" also
// carries the TOP CANDIDATE's price_book_id/item_name — a best guess, not a
// match; the panel badges it separately (≈ best match).
export type ScopeChip = {
  scopeItemId: string;
  name: string;
  q1: string;
  q2: string;
  q3: string;
  groundingStatus: string;
  priceBookId: string | null;
  groundingItemName: string | null;
  sellPriceDollars: number | null;
  gapFlags: string[];
};

export type ConvQuestion = {
  id: string;
  text: string;
  parameter: string;
  scopeItemId: string | null;
};

export type ExtractResult =
  | {
      ok: true;
      scopeItems: ScopeChip[];
      questions: ConvQuestion[];
      // The backend's scope_items array VERBATIM, so propose can pass it back
      // untouched (the contract's scope_items pass-through).
      rawScopeItems: unknown[];
    }
  | { ok: false; error: string };

export type ProposedLine = {
  itemName: string;
  description: string;
  laborHours: number;
  crewSize: number;
  materialsCostDollars: number;
  modifiersApplied: string[];
  // The backend's deterministic sell price. Null when it didn't send one — the
  // panel falls back to the builder's own formula math for display.
  lineSellPriceDollars: number | null;
  grounding: { status: string; priceBookId: string | null; pricebookItemName: string | null };
  q1: string;
  q2: string;
  q3: string;
};

// Option-scoped fee (permit / equipment / discount) charged ONCE per option
// and NOT folded into any line's line_sell_price_dollars — it must be surfaced
// and added separately or the money silently drops. Zero-amount entries are
// skipped; negative amounts (discounts) are kept and flagged in the UI.
export type ProposedFee = {
  name: string;
  amountDollars: number;
  kind: string; // permit | equipment | discount | "" when unspecified
};

export type ProposedOption = {
  optionLabel: string;
  description: string;
  subtotalDollars: number | null;
  lineItems: ProposedLine[];
  feeLines: ProposedFee[];
};

export type ProposeResult =
  | { ok: true; options: ProposedOption[] }
  | { ok: false; error: string };

// ── Tolerant field readers (contract-deviation shock absorbers) ──────────────

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}
function asStrOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number") return String(v);
  return null;
}
function asNumOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asStrArr(v: unknown): string[] {
  return asArr(v).filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

// Clamp + coerce the client's conversation turns before sending (never trust
// component state blindly; also keeps a runaway transcript from ballooning).
function sanitizeConversation(conversation: ConversationTurn[]): ConversationTurn[] {
  return (conversation ?? [])
    .filter((t) => t && typeof t.text === "string" && t.text.trim() !== "")
    .slice(0, 200)
    .map((t) => ({
      speaker: t.speaker === "system" ? "system" : "tech",
      text: t.text.trim().slice(0, 8000),
    }));
}

// Shared POST → tolerant-JSON plumbing for both modes.
async function callConversationFn(body: Record<string, unknown>): Promise<
  { ok: true; json: Record<string, unknown> } | { ok: false; error: string }
> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, error: "Server isn't configured for this yet (missing SUPABASE_URL / service-role key)." };
  }
  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/estimate-from-conversation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the pricing service: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await r.text();
  let json: Record<string, unknown>;
  try {
    json = asObj(JSON.parse(text));
  } catch {
    return { ok: false, error: `The pricing service returned an unexpected response (${r.status}).` };
  }
  if (!r.ok || json.ok === false) {
    const msg = asStr(json.error, "").trim();
    return { ok: false, error: msg || `Pricing service error (${r.status}).` };
  }
  return { ok: true, json };
}

// ── Extract: narration → scope items + judgment questions ───────────────────

export async function conversationExtract(input: {
  conversation: ConversationTurn[];
  hcpJobId?: string;
}): Promise<ExtractResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const conversation = sanitizeConversation(input.conversation);
  if (conversation.length === 0) return { ok: false, error: "Describe the work first." };

  const body: Record<string, unknown> = { mode: "extract", conversation };
  if (input.hcpJobId && input.hcpJobId.trim()) body.hcp_job_id = input.hcpJobId.trim();

  const res = await callConversationFn(body);
  if (!res.ok) return res;

  const rawScopeItems = asArr(res.json.scope_items);
  const scopeItems: ScopeChip[] = rawScopeItems.map((s, i) => {
    const o = asObj(s);
    const cls = asObj(o.classification);
    const g = asObj(o.grounding);
    return {
      scopeItemId: asStr(o.scope_item_id, `scope_${i}`),
      name: asStr(o.name, "(unnamed scope)"),
      q1: asStr(cls.q1_service_type),
      q2: asStr(cls.q2_category),
      q3: asStr(cls.q3_work_type),
      groundingStatus: asStr(g.status, "custom"),
      priceBookId: asStrOrNull(g.price_book_id),
      groundingItemName: asStrOrNull(g.item_name),
      sellPriceDollars: asNumOrNull(g.sell_price_dollars),
      gapFlags: asStrArr(o.gap_flags),
    };
  });

  const questions: ConvQuestion[] = asArr(res.json.questions).map((q, i) => {
    const o = asObj(q);
    return {
      id: asStr(o.id, `q_${i}`),
      text: asStr(o.text, "(question)"),
      parameter: asStr(o.parameter),
      scopeItemId: asStrOrNull(o.scope_item_id),
    };
  }).filter((q) => q.text.trim() !== "" && q.text !== "(question)");

  return { ok: true, scopeItems, questions, rawScopeItems };
}

// ── Propose: conversation + answers → deterministic proposed line items ─────

export async function conversationPropose(input: {
  conversation: ConversationTurn[];
  answers: Array<{ question_id: string; answer: string }>;
  // Verbatim scope_items from conversationExtract's rawScopeItems.
  scopeItems?: unknown[];
}): Promise<ProposeResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const conversation = sanitizeConversation(input.conversation);
  if (conversation.length === 0) return { ok: false, error: "Describe the work first." };

  const answers = (input.answers ?? [])
    .filter((a) => a && typeof a.question_id === "string" && typeof a.answer === "string" && a.answer.trim() !== "")
    .slice(0, 50)
    .map((a) => ({ question_id: a.question_id, answer: a.answer.trim().slice(0, 2000) }));

  // Actor = the current tech identity (name preferred over email), so the
  // backend can attribute judgment calls to a person.
  const me = await getCurrentTech();
  const actor = {
    name: me?.tech?.tech_short_name || me?.tech?.hcp_full_name || writer.email,
    role: writer.role,
  };

  const body: Record<string, unknown> = {
    mode: "build",
    propose_only: true,
    conversation,
    answers,
    actor,
  };
  if (Array.isArray(input.scopeItems) && input.scopeItems.length > 0) body.scope_items = input.scopeItems;

  const res = await callConversationFn(body);
  if (!res.ok) return res;

  const proposal = asObj(res.json.proposal);
  const options: ProposedOption[] = asArr(proposal.options).map((opt, oi) => {
    const o = asObj(opt);
    const lineItems: ProposedLine[] = asArr(o.line_items).map((li) => {
      const l = asObj(li);
      const g = asObj(l.grounding);
      const itemName = (asStr(l.item_name) || asStr(g.pricebook_item_name)).trim();
      const crew = asNumOrNull(l.crew_size);
      return {
        itemName,
        description: asStr(l.description),
        laborHours: Math.max(0, asNumOrNull(l.labor_hours) ?? 0),
        // Default crew 2 — the builder's own blank-line default.
        crewSize: Math.max(1, Math.min(7, Math.round(crew ?? 2) || 2)),
        materialsCostDollars: Math.max(0, asNumOrNull(l.materials_cost_dollars) ?? 0),
        modifiersApplied: asStrArr(l.modifiers_applied),
        lineSellPriceDollars: asNumOrNull(l.line_sell_price_dollars),
        grounding: {
          status: asStr(g.status, "custom"),
          priceBookId: asStrOrNull(g.price_book_id),
          pricebookItemName: asStrOrNull(g.pricebook_item_name),
        },
        q1: asStr(l.q1_service_type),
        q2: asStr(l.q2_category),
        q3: asStr(l.q3_work_type),
      };
    }).filter((l) => l.itemName !== "");
    // Option-scoped fee_lines — tolerate name|label, amount|amount_dollars,
    // kind|category. Skip zero-amount entries; keep negatives (discounts).
    const feeLines: ProposedFee[] = asArr(o.fee_lines).map((f) => {
      const x = asObj(f);
      return {
        name: (asStr(x.name) || asStr(x.label)).trim() || "Option fee",
        amountDollars: asNumOrNull(x.amount) ?? asNumOrNull(x.amount_dollars) ?? 0,
        kind: (asStr(x.kind) || asStr(x.category)).trim().toLowerCase(),
      };
    }).filter((f) => f.amountDollars !== 0);
    return {
      optionLabel: (asStr(o.option_label) || asStr(o.name)).trim() || `Option ${oi + 1}`,
      description: asStr(o.description),
      subtotalDollars: asNumOrNull(o.subtotal_dollars),
      lineItems,
      feeLines,
    };
    // An option carrying only fees still holds money — keep it.
  }).filter((o) => o.lineItems.length > 0 || o.feeLines.length > 0);

  if (options.length === 0) {
    return { ok: false, error: "No line items came back — add a bit more detail about the work and try again." };
  }
  return { ok: true, options };
}
