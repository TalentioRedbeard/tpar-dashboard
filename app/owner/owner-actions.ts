"use server";

// /owner — Owner Control Panel server actions (2026-07-07).
// Danny's daily mission-control write paths. EVERY action here is owner-gated via
// requireOwner() (stricter than isAdmin — office managers can't flip these). The page
// itself is admin-gated for VIEW; these mutations are owner-only.
//
// Levers:
//  - addImprovementNote / setImprovementNoteStatus — the owner's "requirements for
//    improvement" capture (owner_improvement_notes; service-role only, RLS no-policy).
//  - approveDoctrine / retireDoctrine — the field_doctrine tech-visibility gate
//    (approve=publish to techs; retire=active:false, drops the draft from the queue).
//    Content edits already auto-revoke approval via a DB trigger; this is the human gate.
//  - toggleAppFlag — generic app_flags upsert (sms_notifications, phone_login_enabled, …).
// The follow-up engine kill-switch REUSES the existing owner-gated updateFollowupConfig
// (app/dispatch/followup-actions) via the shared FollowupConfigPanel — not re-implemented here.

import { db } from "@/lib/supabase";
import { requireOwner } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

const NOTE_STATUSES = ["open", "doing", "done", "dropped"] as const;
type NoteStatus = (typeof NOTE_STATUSES)[number];

// ── Improvement-note capture ────────────────────────────────────────────────
export async function addImprovementNote(input: { note: string; area?: string | null }): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };

  const note = String(input.note ?? "").trim();
  if (!note) return { ok: false, error: "Write the improvement first." };
  if (note.length > 2000) return { ok: false, error: "Keep the note under 2000 characters." };
  const area = (input.area ?? "").trim() || null;

  const { error } = await db().from("owner_improvement_notes").insert({
    note,
    area,
    created_by: owner.email,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner");
  return { ok: true };
}

export async function setImprovementNoteStatus(id: string, status: NoteStatus): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  if (!NOTE_STATUSES.includes(status)) return { ok: false, error: "Unknown status." };

  const { error } = await db()
    .from("owner_improvement_notes")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner");
  return { ok: true };
}

// ── Field-doctrine approval gate ────────────────────────────────────────────
// Approve = publish the card to every tech consumer (FieldGuide, daily principle,
// coaching money ladder, appguide brief). A content edit knocks it back to pending
// via the field_doctrine_edit_revokes_approval trigger — so this is the sole path in.
export async function approveDoctrine(id: string): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db()
    .from("field_doctrine")
    .update({ approved: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner");
  return { ok: true };
}

// Keep hidden = retire the draft (active:false). It stays unapproved AND leaves the
// review queue, rather than lingering pending forever. Reversible in SQL if needed.
export async function retireDoctrine(id: string): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db()
    .from("field_doctrine")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner");
  return { ok: true };
}

// ── App-flag toggles ────────────────────────────────────────────────────────
// Generic owner-only upsert over the app_flags key/value switchboard. Mirrors the
// write shape used by lib/settings-actions (key, enabled, updated_by, updated_at).
export async function toggleAppFlag(key: string, enabled: boolean): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const k = String(key ?? "").trim();
  if (!k) return { ok: false, error: "Missing flag key." };
  const { error } = await db()
    .from("app_flags")
    .upsert({ key: k, enabled, updated_by: owner.email, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner");
  // Flags cross-cut the app (SMS gate is read on /inbox, phone-login on /login).
  revalidatePath("/settings");
  return { ok: true };
}
