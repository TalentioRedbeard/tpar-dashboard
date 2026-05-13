// Typed query layer for the public.job_360 view.
//
// Source-of-truth: mirrors @tpar-forge/schemas/jobs (eventually canonical
// in tpar-forge). For v0 lives in the dashboard; sync manually when adding
// columns to job_360 view until tpar-forge monorepo publishing is solid.
//
// Per Danny 2026-05-04 (#120): pick the highest-churn read (job_360); make
// that read flow exclusively through a typed client. Schema drift breaks at
// compile time, not at 11 PM.
//
// Pattern: typed identifier in (discriminated union) → validated row out.
// Money columns are split with explicit suffixes (_dollars vs _cents) so
// unit confusion fails the type check.

import { db } from "@/lib/supabase";
import { z } from "zod";
import type { Dollars } from "./money";

// ─── Identifier ─────────────────────────────────────────────────────────
export type JobIdentifier =
  | { kind: "hcp_id"; value: string }
  | { kind: "invoice"; value: string }
  | { kind: "customer_name"; value: string };

// ─── Row schema (mirrors job_360 view 2026-05-04) ──────────────────────
// All money fields here are in dollars (the view divides hcp_invoices_raw
// cents by 100). New columns added to the view should be added here too.
export const Job360RowSchema = z.object({
  hcp_job_id: z.string(),
  invoice_number: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  hcp_customer_id: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  job_date: z.string().nullable().optional(),
  appointment_status: z.string().nullable().optional(),
  crew_size: z.number().nullable().optional(),
  tech_primary_name: z.string().nullable().optional(),
  tech_all_names: z.array(z.string()).nullable().optional(),
  collection_status: z.string().nullable().optional(),

  // Money — all in dollars per job_360 view definition (verified 2026-05-04)
  revenue: z.number().nullable().optional(),
  due_amount: z.number().nullable().optional(),
  labor_revenue: z.number().nullable().optional(),
  materials_revenue: z.number().nullable().optional(),
  other_revenue: z.number().nullable().optional(),
  materials_cost: z.number().nullable().optional(),
  receipts_cost: z.number().nullable().optional(),
  gross_margin: z.number().nullable().optional(),
  billed_labor_est: z.number().nullable().optional(),
  crew_rate_per_hr: z.number().nullable().optional(),

  // Percentages + counts
  gross_margin_pct: z.number().nullable().optional(),
  days_outstanding: z.number().nullable().optional(),
  line_item_count: z.number().nullable().optional(),
  receipt_count: z.number().nullable().optional(),
  receipt_matched: z.boolean().nullable().optional(),
  pricing_flag: z.string().nullable().optional(),

  // GPS + timing
  time_on_site_minutes: z.number().nullable().optional(),
  gps_matched: z.boolean().nullable().optional(),
  arrival_chicago: z.string().nullable().optional(),
  on_time: z.boolean().nullable().optional(),
  minutes_early: z.number().nullable().optional(),

  // Communications layer
  comm_count_for_job: z.number().nullable().optional(),
  comm_count_customer_30d_window: z.number().nullable().optional(),
  open_followups_for_customer: z.number().nullable().optional(),
  most_recent_comm_for_customer: z.string().nullable().optional(),
  peak_importance_in_window: z.number().nullable().optional(),
  topics_in_window: z.array(z.string()).nullable().optional(),

  // Photos
  photo_count: z.number().nullable().optional(),

  // Estimates
  bid_estimate_count: z.number().nullable().optional(),
  bid_customer_approved_at: z.string().nullable().optional(),
  bid_tech_authorized_at: z.string().nullable().optional(),
  hcp_estimate_number: z.string().nullable().optional(),
  has_approved_option: z.boolean().nullable().optional(),

  // SalesAsk recordings (added 2026-05-02)
  salesask_recording_count: z.number().nullable().optional(),
  salesask_latest_recording_id: z.string().nullable().optional(),
  salesask_latest_recording_name: z.string().nullable().optional(),
  salesask_latest_recorded_at: z.string().nullable().optional(),
  salesask_latest_url_mp3: z.string().nullable().optional(),
  salesask_latest_scope_notes: z.string().nullable().optional(),
  salesask_latest_pricing_notes: z.string().nullable().optional(),
  salesask_latest_additional_notes: z.string().nullable().optional(),
  salesask_latest_match_method: z.string().nullable().optional(),
  salesask_latest_match_confidence: z.number().nullable().optional(),
}).passthrough(); // tolerate new columns until next sync

export type Job360Row = z.infer<typeof Job360RowSchema>;

// ─── Result wrapper ─────────────────────────────────────────────────────
export type FindJobResult =
  | { match: "unique"; row: Job360Row }
  | { match: "multiple"; rows: Job360Row[]; disambiguation_hint: string }
  | { match: "none" };

// ─── Validated query ────────────────────────────────────────────────────
export async function findJob360ByIdentifier(id: JobIdentifier): Promise<FindJobResult> {
  const c = db();
  let query = c.from("job_360").select("*");

  switch (id.kind) {
    case "hcp_id":
      query = query.eq("hcp_job_id", id.value).limit(2);
      break;
    case "invoice": {
      // HCP segments invoice numbers ("27691177-3"); split on '-' to match the trunk
      const trunk = id.value.split("-")[0];
      query = query.ilike("invoice_number", `${trunk}%`).limit(20);
      break;
    }
    case "customer_name":
      query = query.ilike("customer_name", `%${id.value}%`).limit(20);
      break;
  }

  const { data, error } = await query;
  if (error) throw new Error(`typed-db/job-360: ${error.message}`);

  const rows = (data ?? [])
    .map((r) => Job360RowSchema.safeParse(r))
    .filter((r): r is z.ZodSafeParseSuccess<Job360Row> => r.success)
    .map((r) => r.data);

  if (rows.length === 0) return { match: "none" };
  if (rows.length === 1) return { match: "unique", row: rows[0]! };

  const hint =
    id.kind === "customer_name"
      ? "customer name matched multiple jobs — disambiguate by invoice or hcp_job_id"
      : "identifier matched multiple jobs — try the trunk + segment suffix";
  return { match: "multiple", rows, disambiguation_hint: hint };
}

/** Convenience wrapper — returns the Job360Row or null. */
export async function getJob360(hcp_job_id: string): Promise<Job360Row | null> {
  const result = await findJob360ByIdentifier({ kind: "hcp_id", value: hcp_job_id });
  return result.match === "unique" ? result.row : null;
}

/**
 * Resolve a user-provided "job number" to a job_360 row. Techs SEE and SHARE
 * invoice/estimate numbers (7-9 digits like "27691236"); HCP's actual IDs are
 * `job_xxxx...`. When the user pastes/types the visible number into a URL or
 * form, we need to resolve it back to hcp_job_id.
 *
 * Resolution order:
 *   1. If it looks like an hcp_job_id (starts with "job_") → try hcp_id match
 *   2. If it's all digits 6-9 chars → try invoice match (handles "X-3" suffix)
 *   3. Otherwise → try invoice match anyway (cheap)
 *
 * Returns the row + the kind that matched, OR a list (when multiple invoice
 * segments share the trunk and caller needs to pick), OR null.
 *
 * Live HCP estimate-number fallback is intentionally NOT done here — that's
 * an external network call that belongs to the calling page (so the caller
 * can decide whether to redirect or render a picker).
 */
export type ResolveJobResult =
  | { kind: "hcp_id"; row: Job360Row }
  | { kind: "invoice"; row: Job360Row; was_segmented: boolean }
  | { kind: "invoice_multiple"; rows: Job360Row[]; trunk: string }
  | { kind: "none"; input: string };

export async function resolveJobIdentifier(input: string): Promise<ResolveJobResult> {
  const v = input.trim();
  if (!v) return { kind: "none", input };

  // Path 1: looks like hcp_id (starts with job_)
  if (v.startsWith("job_")) {
    const r = await findJob360ByIdentifier({ kind: "hcp_id", value: v });
    if (r.match === "unique") return { kind: "hcp_id", row: r.row };
    return { kind: "none", input: v };
  }

  // Path 2: all digits 6-9 chars (with optional -N segment suffix)
  const digitMatch = /^\d{6,9}(-\d+)?$/.test(v);
  if (digitMatch) {
    const r = await findJob360ByIdentifier({ kind: "invoice", value: v });
    if (r.match === "unique") {
      return { kind: "invoice", row: r.row, was_segmented: v.includes("-") };
    }
    if (r.match === "multiple") {
      const trunk = v.split("-")[0]!;
      return { kind: "invoice_multiple", rows: r.rows, trunk };
    }
    return { kind: "none", input: v };
  }

  // Path 3: fallback — try invoice match for anything else
  // (handles unusual formats like leading-zero or alphanumeric estimate IDs)
  const fallback = await findJob360ByIdentifier({ kind: "invoice", value: v });
  if (fallback.match === "unique") return { kind: "invoice", row: fallback.row, was_segmented: false };
  if (fallback.match === "multiple") {
    return { kind: "invoice_multiple", rows: fallback.rows, trunk: v };
  }
  return { kind: "none", input: v };
}

/** Convenience: type-safe accessor for the dollar-valued revenue column. */
export function jobRevenueDollars(row: Job360Row): Dollars | null {
  if (row.revenue == null) return null;
  return row.revenue as Dollars;
}

/** Convenience: type-safe accessor for the dollar-valued due_amount column. */
export function jobDueDollars(row: Job360Row): Dollars | null {
  if (row.due_amount == null) return null;
  return row.due_amount as Dollars;
}
