// Shared types + parsing helpers for the AI-estimate REVIEW surface
// (/estimate/[id]/review). This is the human-in-the-loop for the
// 'estimate-from-conversation' build-mode edge fn: that fn writes a DRAFT to
// bid_estimates (status='draft') + bid_estimate_lines (each carrying a rich
// `intake` jsonb with the AI's reasoning, materials provenance, gap/reprice
// flags, and block_push). A tech assigned to the job reviews the multi-option
// estimate here BEFORE anything is pushed to HCP.
//
// PLAIN module (no "use client") so both the server page AND the client
// ReviewControls can import these values + types without tripping the RSC
// no-client-value-imports eslint rule. DOLLARS throughout — line_sell_price,
// materials_cost_internal, subtotal, and the *_DOLLARS intake fields are all
// dollars (see memory: money-units-map 2026-06-02; bid_estimates is the
// dollars side, NOT cents).

export type OptionRank = "good" | "better" | "best" | null;

export type RepriceSeverity = "block" | "warn" | "info";

export type RepriceFlag = {
  code: string;
  message: string;
  severity: RepriceSeverity;
  detail?: Record<string, unknown>;
};

export type GapFlag = {
  parameter: string;
  question_text: string;
  price_impact?: string; // low | medium | high
};

export type LineActor = {
  id: string | null;
  name: string | null;
  role: string | null;
};

// The `intake` jsonb the build-mode fn writes on every line. Everything is
// optional/defensive — the fn's shape may evolve, so the UI must never crash on
// a missing field.
export type LineIntake = {
  source?: string;            // 'ai_conversation'
  actor?: LineActor | null;
  option_name?: string | null;
  option_rank?: OptionRank;
  q1?: string | null;
  q2?: string | null;
  q3?: string | null;
  materials_source?: string | null;         // 'catalog' | 'distributor_quote_needed'
  materials_source_ref?: string | null;     // the catalog ref string when matched
  materials_reference_DOLLARS?: number | null;
  materials_hint_DOLLARS?: number | null;    // AI rough guess (NOT priced)
  reasoning?: string | null;
  gap_flags?: GapFlag[] | null;
  reprice_flags?: RepriceFlag[] | null;
  block_push?: boolean | null;
  is_custom?: boolean | null;
  is_fee_line?: boolean | null;
  [k: string]: unknown;
};

export type ReviewLine = {
  id: number;
  option_label: string;       // 'A' | 'B' | 'C'
  line_type: string;          // 'scope' | 'fee' | 'material' | 'service'
  sort_order: number;
  item_name: string;
  labor_hours: number | null;
  materials_cost_internal: number | null; // DOLLARS
  modifier_total: number | null;
  line_sell_price: number | null;          // DOLLARS
  matched_from: string;                    // 'price_book' | 'manual' | 'gap'
  price_book_id: number | null;
  intake: LineIntake | null;
};

export type ReviewEstimate = {
  id: string;
  status: string | null;
  source: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  hcp_estimate_id: string | null;
  customer_name: string | null;
  project_name: string | null;
  scope_text: string | null;
  work_description: string | null;
  subtotal: number | null;            // DOLLARS (primary option)
  total_materials_cost: number | null; // DOLLARS
  created_by: string | null;
  created_at: string;
  tech_authorized_at: string | null;
  tech_authorized_option_id: string | null;
  tech_authorization_basis: string | null;
  tech_authorization_note: string | null;
};

// Number coercion — the DB returns numerics as strings via the JS client.
export function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// $X with no cents — matches the builder's `money()` convention (rounded
// whole dollars). All sell-price/materials values here are already DOLLARS.
export function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}

// Rank → ordering priority. good < better < best; nulls sort after.
const RANK_ORDER: Record<string, number> = { good: 0, better: 1, best: 2 };
export function rankPriority(rank: OptionRank): number {
  if (rank && rank in RANK_ORDER) return RANK_ORDER[rank];
  return 99;
}

// Rank → Pill tone (semantic, not raw color).
export function rankTone(rank: OptionRank): "slate" | "brand" | "green" {
  if (rank === "best") return "green";
  if (rank === "better") return "brand";
  return "slate"; // good / null
}

// A grouped option: all lines sharing an option_label, plus the rank/name
// hoisted from the lines' intake (the AI puts the same option_name/rank on
// every line of an option).
export type ReviewOption = {
  label: string;
  name: string | null;
  rank: OptionRank;
  lines: ReviewLine[];
  subtotal: number;          // sum of line_sell_price (DOLLARS)
  hasBlock: boolean;         // any line with block_push or a 'block'-severity reprice flag
  needsQuoteCount: number;   // lines whose materials need a distributor quote
  catalogCount: number;      // lines whose materials are catalog-referenced
};

// Is a line's materials sourced from the catalog (priced) vs. needing a
// distributor quote (unpriced AI guess)?
export function materialsNeedQuote(line: ReviewLine): boolean {
  return line.intake?.materials_source === "distributor_quote_needed";
}
export function materialsFromCatalog(line: ReviewLine): boolean {
  return line.intake?.materials_source === "catalog";
}

// A line is "blocked" if the build-mode fn set block_push OR emitted a
// reprice flag with severity 'block'. Either way it must NOT be pushed as-is.
export function lineIsBlocked(line: ReviewLine): boolean {
  if (line.intake?.block_push) return true;
  return (line.intake?.reprice_flags ?? []).some((f) => f.severity === "block");
}

export function lineRepriceFlags(line: ReviewLine): RepriceFlag[] {
  return line.intake?.reprice_flags ?? [];
}
export function lineGapFlags(line: ReviewLine): GapFlag[] {
  return line.intake?.gap_flags ?? [];
}

// Group lines into ordered options. Lines arrive ordered by (option_label,
// sort_order); we group on option_label, hoist name/rank from the first line
// that carries them, and order options by rank priority then label.
export function groupOptions(lines: ReviewLine[]): ReviewOption[] {
  const byLabel = new Map<string, ReviewLine[]>();
  for (const l of lines) {
    const arr = byLabel.get(l.option_label) ?? [];
    arr.push(l);
    byLabel.set(l.option_label, arr);
  }

  const options: ReviewOption[] = [];
  for (const [label, group] of byLabel) {
    const sorted = [...group].sort((a, b) => a.sort_order - b.sort_order);
    const withName = sorted.find((l) => l.intake?.option_name);
    const withRank = sorted.find((l) => l.intake?.option_rank);
    const subtotal = sorted.reduce((s, l) => s + (l.line_sell_price ?? 0), 0);
    const hasBlock = sorted.some(lineIsBlocked);
    const needsQuoteCount = sorted.filter(materialsNeedQuote).length;
    const catalogCount = sorted.filter(materialsFromCatalog).length;
    options.push({
      label,
      name: withName?.intake?.option_name ?? null,
      rank: (withRank?.intake?.option_rank ?? null) as OptionRank,
      lines: sorted,
      subtotal,
      hasBlock,
      needsQuoteCount,
      catalogCount,
    });
  }

  return options.sort((a, b) => {
    const rp = rankPriority(a.rank) - rankPriority(b.rank);
    if (rp !== 0) return rp;
    return a.label.localeCompare(b.label);
  });
}

// Pricing-coverage rollup across every line of the estimate: how many lines
// reference the priced catalog vs. how many still need a distributor quote.
export type PricingCoverage = {
  total: number;
  catalog: number;
  needQuote: number;
  blocked: number;
};
export function pricingCoverage(lines: ReviewLine[]): PricingCoverage {
  return {
    total: lines.length,
    catalog: lines.filter(materialsFromCatalog).length,
    needQuote: lines.filter(materialsNeedQuote).length,
    blocked: lines.filter(lineIsBlocked).length,
  };
}

// Did the build-mode fn flag a site visit? It records this as a reprice/gap
// signal on a line (no dedicated column on the draft). We surface it if ANY
// line carries a gap flag about access/site conditions OR an explicit
// site_visit hint in intake. Defensive: only returns true on a clear signal.
export function siteVisitRecommended(lines: ReviewLine[]): boolean {
  for (const l of lines) {
    if (l.intake?.site_visit_recommended === true) return true;
    if ((l.intake?.materials_source_ref ?? "").toString().toLowerCase().includes("site visit")) return true;
  }
  return false;
}

// Does this estimate read as AI-built? Any line carrying intake.source =
// 'ai_conversation' marks the whole draft as AI-generated (the list badge).
export function isAiBuilt(lines: Array<{ intake: LineIntake | null }>): boolean {
  return lines.some((l) => l.intake?.source === "ai_conversation");
}
