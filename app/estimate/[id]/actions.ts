"use server";

// Estimate detail-page server actions. Edit is admin-gated; viewing is open
// to any signed-in user (the estimates list is already org-visible).

import { db } from "@/lib/supabase";
import { getCurrentTech, requireWriter } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Service-role lane: the dashboard already holds this key (lib/supabase.ts), so the
// send-estimate call needs NO separate trigger secret — requireServiceCaller accepts it.
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type EstimateDetail = {
  id: string;
  project_name: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  hcp_job_id: string | null;
  hcp_estimate_id: string | null;
  hcp_estimate_number: string | null;
  status: string | null;
  source: string | null;
  created_at: string;
  created_by: string | null;
  hcp_pushed_at: string | null;
  customer_approved_at: string | null;
  tech_authorized_at: string | null;
  /** True if any line was written by the build-mode AI (intake.source =
   *  'ai_conversation'). Drives the "Review AI estimate" deep-link. */
  is_ai_built: boolean;
};

const COLS =
  "id, project_name, customer_name, hcp_customer_id, hcp_job_id, hcp_estimate_id, hcp_estimate_number, status, source, created_at, created_by, hcp_pushed_at, customer_approved_at, tech_authorized_at";

export async function getEstimateDetail(id: string): Promise<EstimateDetail | null> {
  const supa = db();
  const { data } = await supa.from("bid_estimates").select(COLS).eq("id", id).maybeSingle();
  if (!data) return null;
  // Cheap AI-built probe: does any line carry an ai_conversation intake?
  const { data: aiLine } = await supa
    .from("bid_estimate_lines")
    .select("id")
    .eq("estimate_id", id)
    .eq("intake->>source", "ai_conversation")
    .limit(1)
    .maybeSingle();
  return { ...(data as Record<string, unknown>), is_ai_built: !!aiLine } as unknown as EstimateDetail;
}

export async function updateEstimate(
  id: string,
  input: { status?: string | null; projectName?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me?.isAdmin) return { ok: false, error: "Only admins can edit estimates." };

  const patch: Record<string, unknown> = {};
  if (input.status !== undefined) patch.status = input.status?.trim() || null;
  if (input.projectName !== undefined) patch.project_name = input.projectName?.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await db().from("bid_estimates").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/estimate/${id}`);
  revalidatePath("/estimates");
  return { ok: true };
}

// ── Send to customer (tracked) ───────────────────────────────────────────────
// Phase 2 v1: own the estimate SEND via Resend. Calls the send-estimate edge fn
// (service-role lane), which renders the branded email, sends via Resend, and
// records an estimate_sends row whose token backs the /e/<token> hosted view +
// open/click tracking. Writer-gated (admin or tech; managers blocked). Optionally
// overrides the recipient email when the HCP record lacks one.
export type SendEstimateResult =
  | { ok: true; view_url: string | null }
  | { ok: false; error: string };

export async function sendEstimateToCustomer(
  id: string,
  input?: { message?: string; toEmail?: string }
): Promise<SendEstimateResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { ok: false, error: "Server isn't configured to send yet (missing SUPABASE_URL / service-role key)." };
  }

  // The detail page is keyed by bid_estimates.id; the send fn needs the HCP id.
  const { data: est } = await db()
    .from("bid_estimates")
    .select("hcp_estimate_id")
    .eq("id", id)
    .maybeSingle();
  const hcpEstimateId = (est?.hcp_estimate_id as string | null) ?? null;
  if (!hcpEstimateId) {
    return { ok: false, error: "This estimate isn't linked to an HCP estimate yet, so there's nothing to send." };
  }

  const body: Record<string, unknown> = {
    hcp_estimate_id: hcpEstimateId,
    created_by: writer.email,
  };
  if (input?.message && input.message.trim()) body.message = input.message.trim().slice(0, 8000);
  if (input?.toEmail && input.toEmail.trim()) body.to_email = input.toEmail.trim();

  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/send-estimate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "apikey": SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the send service: ${e instanceof Error ? e.message : String(e)}` };
  }

  const text = await r.text();
  let parsed: { ok?: boolean; error?: string; view_url?: string | null };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: `Send service returned an unexpected response (${r.status}).` }; }

  if (!parsed.ok) {
    if (parsed.error === "no_recipient_email") {
      return { ok: false, error: "No email on file for this customer — add one in HCP or enter a recipient email and try again." };
    }
    return { ok: false, error: parsed.error ?? `Send failed (${r.status}).` };
  }

  revalidatePath(`/estimate/${id}`);
  revalidatePath("/estimates");
  return { ok: true, view_url: parsed.view_url ?? null };
}
