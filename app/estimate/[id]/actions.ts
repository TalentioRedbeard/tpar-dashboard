"use server";

// Estimate detail-page server actions. Edit is admin-gated; viewing is open
// to any signed-in user (the estimates list is already org-visible).

import { db } from "@/lib/supabase";
import { getCurrentTech, requireSender } from "@/lib/current-tech";
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
// Phase 2 v2 (plan 2026-07-13 section 3.3): preview-then-confirm on top of the
// send-estimate edge fn (Resend lane; estimate_sends row backs /e/<token> +
// tracking). The guardrails — override-wins recipient resolution, race-safe
// claim, live HCP terminal-state refusal — live IN the edge fn; this action
// adds the requireSender gate (decision #4: managers any, techs only work
// they're scheduled to) and the recipient preview the confirm step shows.

async function resolveHcpLinkage(id: string): Promise<
  | { ok: true; hcpEstimateId: string; hcpJobId: string | null }
  | { ok: false; error: string }
> {
  // The detail page serves BOTH id shapes (template build 2026-07-13): an
  // HCP-native id (csr_/est_) IS the send key; a bid_estimates uuid resolves
  // to one. requireSender can match techs by hcpEstimateId via appointments.
  if (/^(csr_|est_)/.test(id)) {
    return { ok: true, hcpEstimateId: id, hcpJobId: null };
  }
  const { data: est } = await db()
    .from("bid_estimates")
    .select("hcp_estimate_id, hcp_job_id")
    .eq("id", id)
    .maybeSingle();
  const hcpEstimateId = (est?.hcp_estimate_id as string | null) ?? null;
  if (!hcpEstimateId) {
    return { ok: false, error: "This estimate isn't linked to an HCP estimate yet, so there's nothing to send." };
  }
  return { ok: true, hcpEstimateId, hcpJobId: (est?.hcp_job_id as string | null) ?? null };
}

async function callSendEstimate(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { ok: false, error: "Server isn't configured to send yet (missing SUPABASE_URL / service-role key)." };
  }
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
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `Send service returned an unexpected response (${r.status}).` };
  }
}

export type SendPreview =
  | {
      ok: true;
      toEmail: string | null;
      recipientSource: "override" | "hcp_record" | "customers_master" | null;
      customerName: string | null;
      estimateNumber: string | null;
      hcpWorkStatus: string | null;
      terminal: boolean;
      options: number;
    }
  | { ok: false; error: string };

export async function previewEstimateSend(id: string, toEmail?: string): Promise<SendPreview> {
  const link = await resolveHcpLinkage(id);
  if (!link.ok) return { ok: false, error: link.error };
  const sender = await requireSender({ hcpJobId: link.hcpJobId, hcpEstimateId: link.hcpEstimateId });
  if (!sender.ok) return { ok: false, error: sender.error };

  const body: Record<string, unknown> = { hcp_estimate_id: link.hcpEstimateId, dry_run: true };
  if (toEmail && toEmail.trim()) body.to_email = toEmail.trim();
  const parsed = await callSendEstimate(body);
  if (!parsed.ok) return { ok: false, error: (parsed as { error?: string }).error ?? "Preview failed." };
  return {
    ok: true,
    toEmail: (parsed.to_email as string | null) ?? null,
    recipientSource: (parsed.recipient_source as "override" | "hcp_record" | "customers_master" | null) ?? null,
    customerName: (parsed.customer_name as string | null) ?? null,
    estimateNumber: (parsed.estimate_number as string | null) ?? null,
    hcpWorkStatus: (parsed.hcp_work_status as string | null) ?? null,
    terminal: parsed.terminal === true,
    options: Number(parsed.options ?? 0),
  };
}

export type EmailPreview =
  | { ok: true; html: string; subject: string }
  | { ok: false; error: string };

// "Can I see what the customer will actually see?" — the edge fn renders the
// exact email it would send (dry_run + include_html); nothing sends, nothing
// is recorded. The hosted /e/<token> page the email's button opens is the
// other half — a [TEST] send to your own inbox exercises that one for real.
export async function previewEstimateEmail(id: string): Promise<EmailPreview> {
  const link = await resolveHcpLinkage(id);
  if (!link.ok) return { ok: false, error: link.error };
  const sender = await requireSender({ hcpJobId: link.hcpJobId, hcpEstimateId: link.hcpEstimateId });
  if (!sender.ok) return { ok: false, error: sender.error };

  const parsed = await callSendEstimate({ hcp_estimate_id: link.hcpEstimateId, dry_run: true, include_html: true });
  if (!parsed.ok || typeof parsed.email_html !== "string") {
    return { ok: false, error: (parsed as { error?: string }).error ?? "Preview failed." };
  }
  return { ok: true, html: parsed.email_html, subject: String(parsed.subject ?? "Your estimate") };
}

export type SendEstimateResult =
  | { ok: true; view_url: string | null; deduped: boolean }
  | { ok: false; error: string };

export async function sendEstimateToCustomer(
  id: string,
  input?: { message?: string; toEmail?: string }
): Promise<SendEstimateResult> {
  const link = await resolveHcpLinkage(id);
  if (!link.ok) return { ok: false, error: link.error };
  const sender = await requireSender({ hcpJobId: link.hcpJobId, hcpEstimateId: link.hcpEstimateId });
  if (!sender.ok) return { ok: false, error: sender.error };

  const body: Record<string, unknown> = {
    hcp_estimate_id: link.hcpEstimateId,
    created_by: sender.email,
  };
  if (input?.message && input.message.trim()) body.message = input.message.trim().slice(0, 8000);
  if (input?.toEmail && input.toEmail.trim()) body.to_email = input.toEmail.trim();

  const parsed = await callSendEstimate(body);
  if (!parsed.ok) {
    const err = (parsed as { error?: string }).error ?? "Send failed.";
    if (err === "no_recipient_email") {
      return { ok: false, error: "No email on file for this customer — add one in HCP or enter a recipient email and try again." };
    }
    return { ok: false, error: err };
  }

  revalidatePath(`/estimate/${id}`);
  revalidatePath("/estimates");
  return { ok: true, view_url: (parsed.view_url as string | null) ?? null, deduped: parsed.deduped === true };
}
