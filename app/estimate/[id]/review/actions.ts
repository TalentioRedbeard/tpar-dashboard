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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const CREATE_ESTIMATE_SECRET = process.env.CREATE_ESTIMATE_DIRECT_SECRET ?? "";

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

// Approve = record the review sign-off AND send the draft to HousecallPro via the
// direct integration (create-estimate-direct — the same proven path the multi-option
// builder uses). Closes the 2026-07-21 gap where voice/single estimates were reviewed
// but never pushed. Auth: writers only (owner/tech); managers are read-only. The page
// already enforces job-assignment scope for techs.
export async function approveEstimate(input: {
  id: string;
  optionLabel: string | null;
  note?: string | null;
}): Promise<ApproveResult> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "Not signed in." };
  if (!me.canWrite) {
    return { ok: false, error: "Only the owner or a tech assigned to this job can approve a draft." };
  }

  const supa = db();
  const { data: cur } = await supa
    .from("bid_estimates")
    .select("status, hcp_customer_id, hcp_job_id, hcp_address_id, hcp_estimate_id, work_description, scope_text")
    .eq("id", input.id)
    .maybeSingle();
  if (!cur) return { ok: false, error: "Estimate not found." };
  const c = cur as {
    status: string | null; hcp_customer_id: string | null; hcp_job_id: string | null;
    hcp_address_id: string | null; hcp_estimate_id: string | null;
    work_description: string | null; scope_text: string | null;
  };
  if (c.hcp_estimate_id) return { ok: false, error: "This estimate is already in HousecallPro." };
  if (c.status && !["draft", "needs_info", "ready"].includes(c.status)) {
    return { ok: false, error: `This estimate is "${c.status}" — only a draft can be sent.` };
  }
  if (!c.hcp_customer_id) {
    return { ok: false, error: "This draft isn't linked to a customer yet — open it from the job or customer first, then approve." };
  }

  // Record the review sign-off up front, so it's captured even if the push errors.
  const reviewer = me.tech?.tech_short_name ?? me.email;
  const reviewPatch = {
    tech_authorized_at: new Date().toISOString(),
    tech_authorized_option_id: input.optionLabel ?? null,
    tech_authorization_basis: "tech_reviewed_ai_draft",
    tech_authorization_note: [`Reviewed by ${reviewer}`, input.note?.trim() || null].filter(Boolean).join(" — "),
  };

  // Build HCP options from the draft lines. line_sell_price is the line's EXTENDED
  // sell price in DOLLARS (verified: bid_estimates.subtotal == sum(line_sell_price)).
  // Send one unit at that price so the money is exact regardless of the original
  // quantity — never risk a units error on a customer-facing estimate.
  const { data: lineRows } = await supa
    .from("bid_estimate_lines")
    .select("option_label, item_name, description, line_sell_price, sort_order")
    .eq("estimate_id", input.id)
    .order("option_label", { ascending: true })
    .order("sort_order", { ascending: true });
  const rows = (lineRows ?? []) as Array<{ option_label: string | null; item_name: string | null; description: string | null; line_sell_price: number | null; sort_order: number | null }>;
  type Li = { name: string; quantity: number; unit_price_cents: number; description?: string };
  const byOption = new Map<string, Li[]>();
  for (const l of rows) {
    const nm = (l.item_name ?? "").trim();
    if (!nm) continue;
    const cents = Math.round(Number(l.line_sell_price ?? 0) * 100);
    if (!Number.isFinite(cents) || cents < 0) continue;
    const label = (l.option_label ?? "A").trim() || "A";
    const li: Li = { name: nm.slice(0, 255), quantity: 1, unit_price_cents: cents };
    if (l.description?.trim()) li.description = l.description.trim().slice(0, 1000);
    const arr = byOption.get(label);
    if (arr) arr.push(li); else byOption.set(label, [li]);
  }
  const options = [...byOption.entries()].map(([label, line_items]) => ({ name: `Option ${label}`, line_items }));
  if (options.length === 0) {
    return { ok: false, error: "This draft has no priced line items to send." };
  }

  const body: Record<string, unknown> = { hcp_customer_id: c.hcp_customer_id, options };
  if (c.hcp_address_id) body.address_id = c.hcp_address_id;
  const scope = (c.work_description ?? c.scope_text ?? "").trim();
  if (scope) body.note = scope.slice(0, 8000);
  // Pass the acting tech so HCP doesn't drop the technician on the estimate.
  if (me.tech?.hcp_employee_id) body.assigned_employee_ids = [me.tech.hcp_employee_id];

  let pushErr: string | null = null;
  let estId: string | null = null;
  let estNum: string | null = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/create-estimate-direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trigger-Secret": CREATE_ESTIMATE_SECRET },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) pushErr = `HCP push failed: ${r.status} ${text.slice(0, 300)}`;
    else {
      let parsed: { ok?: boolean; error?: string; estimate_id?: string; estimate_number?: string };
      try { parsed = JSON.parse(text); } catch { parsed = {}; }
      if (!parsed.ok) pushErr = parsed.error ?? "create-estimate-direct returned ok=false";
      else { estId = parsed.estimate_id ?? null; estNum = parsed.estimate_number ?? null; }
    }
  } catch (e) {
    pushErr = e instanceof Error ? e.message : String(e);
  }

  if (pushErr) {
    await supa.from("bid_estimates").update({ ...reviewPatch, status: "ready", hcp_push_error: pushErr }).eq("id", input.id);
    revalidatePath(`/estimate/${input.id}/review`);
    return { ok: false, error: `Reviewed, but the send to HousecallPro failed: ${pushErr}` };
  }

  await supa.from("bid_estimates").update({
    ...reviewPatch,
    status: "pushed",
    hcp_estimate_id: estId,
    hcp_estimate_number: estNum,
    hcp_pushed_at: new Date().toISOString(),
    hcp_push_error: null,
  }).eq("id", input.id);

  if (c.hcp_job_id && estId) {
    await supa.from("job_estimate_links").insert({ hcp_job_id: c.hcp_job_id, hcp_estimate_id: estId }).then(() => {}, () => {});
  }

  revalidatePath(`/estimate/${input.id}/review`);
  revalidatePath(`/estimate/${input.id}`);
  revalidatePath("/estimates");
  return { ok: true };
}
