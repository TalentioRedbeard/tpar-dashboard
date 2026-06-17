"use server";

// Server actions for the AI-estimate REVIEW surface. Read is open to any
// signed-in user with access to the estimate (the page itself enforces tech
// job-assignment scope, mirroring /job/[id]); the Approve action is a v0
// stub — it records review INTENT + the reviewing actor and flips the draft to
// 'ready' (the valid post-review status per the bid_estimates_status_check
// constraint — there is intentionally NO HCP push wired here).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";
import { num, type ReviewEstimate, type ReviewLine, type LineIntake } from "@/lib/estimate-review";

const EST_COLS =
  "id, status, source, hcp_job_id, hcp_customer_id, hcp_estimate_id, customer_name, project_name, scope_text, work_description, subtotal, total_materials_cost, created_by, created_at, tech_authorized_at, tech_authorized_option_id, tech_authorization_basis, tech_authorization_note";

const LINE_COLS =
  "id, option_label, line_type, sort_order, item_name, labor_hours, materials_cost_internal, modifier_total, line_sell_price, matched_from, price_book_id, intake";

export async function getReviewEstimate(
  id: string
): Promise<{ estimate: ReviewEstimate; lines: ReviewLine[] } | null> {
  const supa = db();
  const { data: estRow } = await supa.from("bid_estimates").select(EST_COLS).eq("id", id).maybeSingle();
  if (!estRow) return null;

  const e = estRow as Record<string, unknown>;
  const estimate: ReviewEstimate = {
    id: e.id as string,
    status: (e.status as string | null) ?? null,
    source: (e.source as string | null) ?? null,
    hcp_job_id: (e.hcp_job_id as string | null) ?? null,
    hcp_customer_id: (e.hcp_customer_id as string | null) ?? null,
    hcp_estimate_id: (e.hcp_estimate_id as string | null) ?? null,
    customer_name: (e.customer_name as string | null) ?? null,
    project_name: (e.project_name as string | null) ?? null,
    scope_text: (e.scope_text as string | null) ?? null,
    work_description: (e.work_description as string | null) ?? null,
    subtotal: num(e.subtotal),
    total_materials_cost: num(e.total_materials_cost),
    created_by: (e.created_by as string | null) ?? null,
    created_at: e.created_at as string,
    tech_authorized_at: (e.tech_authorized_at as string | null) ?? null,
    tech_authorized_option_id: (e.tech_authorized_option_id as string | null) ?? null,
    tech_authorization_basis: (e.tech_authorization_basis as string | null) ?? null,
    tech_authorization_note: (e.tech_authorization_note as string | null) ?? null,
  };

  const { data: lineRows } = await supa
    .from("bid_estimate_lines")
    .select(LINE_COLS)
    .eq("estimate_id", id)
    .order("option_label", { ascending: true })
    .order("sort_order", { ascending: true });

  const lines: ReviewLine[] = ((lineRows ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    option_label: (r.option_label as string) ?? "A",
    line_type: (r.line_type as string) ?? "scope",
    sort_order: (r.sort_order as number) ?? 0,
    item_name: (r.item_name as string) ?? "—",
    labor_hours: num(r.labor_hours),
    materials_cost_internal: num(r.materials_cost_internal),
    modifier_total: num(r.modifier_total),
    line_sell_price: num(r.line_sell_price),
    matched_from: (r.matched_from as string) ?? "manual",
    price_book_id: (r.price_book_id as number | null) ?? null,
    intake: (r.intake as LineIntake | null) ?? null,
  }));

  return { estimate, lines };
}

export type ApproveResult = { ok: true } | { ok: false; error: string };

// v0 Approve stub. Records that a human reviewed this AI draft + WHO, on which
// option, and flips status draft → 'ready'. Does NOT push to HCP. Auth: any
// writer (owner or tech) — managers are read-only (requireWriter blocks them),
// matching the rest of the app. The page already enforces job-assignment scope
// for techs, so a tech reaching this action is on the job.
export async function approveEstimate(input: {
  id: string;
  optionLabel: string | null;
  note?: string | null;
}): Promise<ApproveResult> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "Not signed in." };
  // Writers only (owner/admin or tech). Managers are read-only by design.
  if (!me.canWrite) {
    return { ok: false, error: "Only the owner or a tech assigned to this job can approve a draft." };
  }

  const supa = db();
  // Guard: only a draft / needs_info estimate can be approved-for-review. Don't
  // clobber an already-pushed or archived row.
  const { data: cur } = await supa.from("bid_estimates").select("status").eq("id", input.id).maybeSingle();
  const status = (cur as { status?: string } | null)?.status ?? null;
  if (!cur) return { ok: false, error: "Estimate not found." };
  if (status && !["draft", "needs_info", "ready"].includes(status)) {
    return { ok: false, error: `This estimate is "${status}" — only a draft can be marked reviewed.` };
  }

  const reviewer = me.tech?.tech_short_name ?? me.email;
  const { error } = await supa
    .from("bid_estimates")
    .update({
      status: "ready",
      tech_authorized_at: new Date().toISOString(),
      tech_authorized_option_id: input.optionLabel ?? null,
      tech_authorization_basis: "tech_reviewed_ai_draft",
      tech_authorization_note: [`Reviewed by ${reviewer}`, input.note?.trim() || null]
        .filter(Boolean)
        .join(" — "),
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/estimate/${input.id}/review`);
  revalidatePath(`/estimate/${input.id}`);
  revalidatePath("/estimates");
  return { ok: true };
}
