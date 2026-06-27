"use server";

// Campaign-draft review — dashboard server actions.
//
// These power /campaigns/review, where office/managers vet AI-personalized
// campaign messages (public.campaign_message_drafts) before they ever send.
//
// DATA ACCESS: campaign_message_drafts has RLS ENABLED with NO policies, so the
// authenticated (anon/PostgREST) role can read or write NOTHING. Every access
// here goes through the service-role db() client (lib/supabase.ts), exactly like
// getGalleryPhotos / the /dispatch data path / the estimate-followup config.
// The page gate only decides whether to render; these actions self-authorize.
//
// GATE: requireResolver() — admin, tech, OR manager (Madisson is a first-class
// resolver, per Danny 2026-05-30). Pure "office" accounts with no dashboard_role
// can VIEW the page but their write actions are rejected here (fail-closed).

import { db } from "./supabase";
import { requireResolver } from "./current-tech";
import { revalidatePath } from "next/cache";

export type ReviewStatus = "pending_review" | "approved" | "rejected" | "edited";
export type SegmentType = "homeowner" | "landlord" | "hold";

export type CampaignDraft = {
  id: string;
  campaign_key: string;
  normalized_email: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  entity_id: string | null;
  assigned_tech: string | null;
  segment_type: SegmentType | null;
  signal: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  basis: Record<string, unknown> | null;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  final_subject: string | null;
  final_body: string | null;
  created_at: string | null;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

const REVALIDATE = "/campaigns/review";

// ── Approve ────────────────────────────────────────────────────────────────
// Marks the draft approved-to-send. HOLD drafts are internal notes, never
// sendable — block them here too so the rule holds even if the UI is bypassed.
export async function approveDraft(id: string): Promise<ActionResult> {
  const actor = await requireResolver();
  if (!actor.ok) return { ok: false, error: actor.error };
  const supa = db();

  const { data: row } = await supa
    .from("campaign_message_drafts")
    .select("id, segment_type")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Draft not found." };
  if (row.segment_type === "hold") {
    return { ok: false, error: "HOLD drafts are internal notes, not sendable — mark them handled instead." };
  }

  const { error } = await supa
    .from("campaign_message_drafts")
    .update({ review_status: "approved", reviewed_by: actor.email, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Materialize the send-decision recipient carrying the RENDERED body (final_* → draft_*). This is
  // the approve→send bridge: it STAGES a campaign_recipients row (include=true, send_status='pending').
  // It sends NOTHING — campaign-send stays disarmed (CAMPAIGN_SEND_ARMED unset + dry_run default).
  const { error: mErr } = await supa.rpc("materialize_campaign_recipient", { p_draft_id: id });
  if (mErr) return { ok: false, error: `approved, but staging failed: ${mErr.message}` };

  revalidatePath(REVALIDATE);
  return { ok: true };
}

// ── Reject / mark handled ────────────────────────────────────────────────────
// Used both to drop a draft and to clear a HOLD ("mark handled").
export async function rejectDraft(id: string): Promise<ActionResult> {
  const actor = await requireResolver();
  if (!actor.ok) return { ok: false, error: actor.error };

  const supa = db();
  const { error } = await supa
    .from("campaign_message_drafts")
    .update({ review_status: "rejected", reviewed_by: actor.email, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Pull it from the send list if it was previously staged (include=false, only while pending).
  // Best-effort: a rejection still succeeds even if the (idempotent) dematerialize hiccups.
  await supa.rpc("dematerialize_campaign_recipient", { p_draft_id: id });

  revalidatePath(REVALIDATE);
  return { ok: true };
}

// ── Edit / save ──────────────────────────────────────────────────────────────
// Writes the human-edited subject + body to final_subject/final_body and sets
// status='edited'. The eventual send step reads final_* with a fall back to the
// AI draft_*. HOLD drafts can't be edited-to-send.
export async function saveDraftEdit(
  id: string,
  subject: string,
  body: string,
): Promise<ActionResult> {
  const actor = await requireResolver();
  if (!actor.ok) return { ok: false, error: actor.error };
  const supa = db();

  const cleanSubject = subject.trim();
  const cleanBody = body.trim();
  if (!cleanSubject) return { ok: false, error: "Subject can't be empty." };
  if (!cleanBody) return { ok: false, error: "Body can't be empty." };

  const { data: row } = await supa
    .from("campaign_message_drafts")
    .select("id, segment_type")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Draft not found." };
  if (row.segment_type === "hold") {
    return { ok: false, error: "HOLD drafts are internal notes — they aren't sendable messages to edit." };
  }

  const { error } = await supa
    .from("campaign_message_drafts")
    .update({
      final_subject: cleanSubject,
      final_body: cleanBody,
      review_status: "edited",
      reviewed_by: actor.email,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // If this draft was ALREADY staged (approved earlier), keep the staged recipient body in sync with
  // the edit. p_only_if_exists=true → refresh the existing pending row but NEVER stage a new one
  // (a plain edit alone does not arm a recipient; Approve does). Sends nothing.
  await supa.rpc("materialize_campaign_recipient", { p_draft_id: id, p_only_if_exists: true });

  revalidatePath(REVALIDATE);
  return { ok: true };
}
