"use server";

// Phase 3 follow-up engine — dashboard server actions.
//  (1) getFollowupConfig / updateFollowupConfig — read + OWNER-only write of the singleton
//      followup_engine_config (kill-switch + auto_send + cadence). Writes go through the
//      service-role db() (RLS: SELECT to authenticated, writes service-role only).
//  (2) sendApprovedNudge — the /dispatch "Send this nudge" action on an estimate_nudge_approval
//      task: re-validates eligibility via estimate_followup_candidates_v AT CLICK TIME (eligibility
//      is time-windowed), POSTs send-estimate-followup (service-role lane), and marks the task
//      done only on a real send (or a no-longer-actionable soft-skip).

import { db } from "@/lib/supabase";
import { getCurrentTech, requireResolver } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type FollowupConfig = {
  id: number;
  enabled: boolean;
  auto_send: boolean;
  first_nudge_days: number;
  quiet_days: number;
  reping_days: number;
  expiry_lead_days: number;
  max_nudges: number;
  email_never_viewed: boolean;
  email_viewed_quiet: boolean;
  business_hour_start: number;
  business_hour_end: number;
  updated_at: string | null;
  updated_by: string | null;
};
export type NudgeResult = { ok: true; note?: string } | { ok: false; error: string };

const CONFIG_KEYS = [
  "enabled", "auto_send", "first_nudge_days", "quiet_days", "reping_days", "expiry_lead_days",
  "max_nudges", "email_never_viewed", "email_viewed_quiet", "business_hour_start", "business_hour_end",
] as const;

// READ — any signed-in user (SELECT granted to authenticated; service-role db() reads regardless).
export async function getFollowupConfig(): Promise<FollowupConfig | null> {
  const me = await getCurrentTech();
  if (!me) return null;
  const { data } = await db().from("followup_engine_config").select("*").eq("id", 1).maybeSingle();
  return (data as FollowupConfig | null) ?? null;
}

// WRITE — OWNER ONLY. The kill-switch is high-stakes; isAdmin includes office managers, so we
// gate on isOwner (Danny). Whitelist keys, clamp bounds, stamp updated_by/at, singleton id=1.
export async function updateFollowupConfig(
  patch: Partial<Pick<FollowupConfig, (typeof CONFIG_KEYS)[number]>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) return { ok: false, error: "Owner only — the follow-up engine is owner-controlled." };

  const clean: Record<string, unknown> = {};
  for (const k of CONFIG_KEYS) if (k in patch && patch[k] !== undefined) clean[k] = patch[k];
  for (const k of ["first_nudge_days", "quiet_days", "reping_days", "expiry_lead_days", "max_nudges"] as const)
    if (k in clean) clean[k] = Math.max(0, Math.min(60, Number(clean[k]) | 0));
  for (const k of ["business_hour_start", "business_hour_end"] as const)
    if (k in clean) clean[k] = Math.max(0, Math.min(23, Number(clean[k]) | 0));
  if (Object.keys(clean).length === 0) return { ok: true };
  clean.updated_at = new Date().toISOString();
  clean.updated_by = me.email;

  const { error } = await db().from("followup_engine_config").update(clean).eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

// SEND — resolver-gated (admin, tech, OR manager). Managers like Madisson are first-class
// resolvers of operational work, so they can approve + send a follow-up nudge from /dispatch.
export async function sendApprovedNudge(taskId: string): Promise<NudgeResult> {
  const actor = await requireResolver();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { ok: false, error: "Server isn't configured to send yet (missing SUPABASE_URL / service-role key)." };
  const supa = db();

  // Resolve the task → hcp_estimate_id; guard the subtype + status.
  const { data: task } = await supa.from("tasks").select("id, ref_kind, ref_id, status").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, error: "Task not found." };
  if (task.ref_kind !== "estimate_nudge_approval") return { ok: false, error: "This task isn't a follow-up approval." };
  const hcpEstimateId = (task.ref_id as string | null) ?? null;
  if (!hcpEstimateId) return { ok: false, error: "This task has no estimate id." };
  if (task.status === "done") return { ok: false, error: "This task is already closed." };

  // Freshness re-check — eligibility is time-windowed (business hours, reping, replied, resolved).
  const { data: cand } = await supa
    .from("estimate_followup_candidates_v")
    .select("eligible_email_never_viewed, eligible_email_viewed_quiet")
    .eq("hcp_estimate_id", hcpEstimateId)
    .maybeSingle();
  if (!cand) return { ok: false, error: "This estimate is no longer in the follow-up pipeline (resolved, revoked, or never sent via Resend)." };
  const segment: "never-viewed" | "viewed-quiet" | null =
    cand.eligible_email_never_viewed ? "never-viewed"
      : cand.eligible_email_viewed_quiet ? "viewed-quiet"
        : null;
  if (!segment) return { ok: false, error: "No longer eligible — the customer may have viewed/replied, it's resolved or capped, or it's outside business hours. Leaving the task open." };

  // POST send-estimate-followup via the service-role lane (Bearer + apikey; no trigger secret).
  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/send-estimate-followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "apikey": SERVICE_ROLE_KEY },
      body: JSON.stringify({ hcp_estimate_id: hcpEstimateId, segment, created_by: actor.email }),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the send service: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await r.text();
  let parsed: { ok?: boolean; error?: string; send_id?: number; deduped?: boolean; capped?: boolean; skipped?: string };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: `Send service returned an unexpected response (${r.status}).` }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? `Send failed (${r.status}).` };

  // Soft-skips (ok:true, no send_id) mean NO email went out but the approval is no longer
  // actionable → close the task (frees the dedupe slot) + surface a friendly note.
  const markDone = async (note?: string): Promise<NudgeResult> => {
    const now = new Date().toISOString();
    await supa.from("tasks").update({ status: "done", done_at: now, updated_at: now }).eq("id", taskId);
    revalidatePath("/dispatch");
    revalidatePath("/estimates");
    return note ? { ok: true, note } : { ok: true };
  };
  if (parsed.deduped) return markDone("Already sent moments ago — task closed.");
  if (parsed.capped) return markDone("Follow-up cap reached — task closed.");
  if (parsed.skipped) return markDone(`No longer awaiting (${parsed.skipped}) — task closed.`);
  if (parsed.send_id) return markDone(); // real send
  return { ok: false, error: "Send service responded ok but didn't confirm a send — left the task open." };
}
