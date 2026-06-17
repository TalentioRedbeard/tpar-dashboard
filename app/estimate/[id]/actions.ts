"use server";

// Estimate detail-page server actions. Edit is admin-gated; viewing is open
// to any signed-in user (the estimates list is already org-visible).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

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
