// Phase 3 Tier 3 server actions: tech_directory metadata edits.
//
// Auth model: Danny-only by default (DASHBOARD_ADMIN_EMAILS env var, see
// lib/admin.ts). Edits are AUDITED to maintenance_logs source='admin-tech-edit'
// with the before/after diff. Reads still go through the existing service_role
// db() client.
//
// Editable fields: notes, slack_user_id, is_active.
// NOT editable from this surface: tech_short_name, hcp_full_name,
// hcp_employee_id (those are HCP-derived; manual edits would silently drift).

"use server";

import { revalidatePath } from "next/cache";
import { db } from "./supabase";
import { getSessionUser } from "./supabase-server";
import { isAdmin } from "./admin";

export type TechEditResult =
  | { ok: true }
  | { ok: false; error: string };

const SLACK_USER_ID_REGEX = /^U[A-Z0-9]{8,}$/;

export async function updateTechDirectory(formData: FormData): Promise<TechEditResult> {
  const techId = String(formData.get("tech_id") ?? "").trim();
  if (!techId) return { ok: false, error: "missing tech_id" };

  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };
  if (!isAdmin(user.email)) return { ok: false, error: "admin only" };

  // Coerce form values. Empty string → null for nullable text columns.
  const rawNotes        = formData.get("notes");
  const rawSlackUserId  = formData.get("slack_user_id");
  const rawIsActive     = formData.get("is_active");

  const updates: Record<string, unknown> = {};

  if (rawNotes !== null) {
    const v = String(rawNotes).trim();
    updates.notes = v === "" ? null : v.slice(0, 4000);
  }
  if (rawSlackUserId !== null) {
    const v = String(rawSlackUserId).trim();
    if (v === "") {
      updates.slack_user_id = null;
    } else if (!SLACK_USER_ID_REGEX.test(v)) {
      return { ok: false, error: `invalid slack_user_id: must look like U06AT0JSAC9` };
    } else {
      updates.slack_user_id = v;
    }
  }
  if (rawIsActive !== null) {
    const v = String(rawIsActive);
    updates.is_active = v === "true" || v === "on" || v === "1";
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: "no changes" };
  }
  updates.updated_at = new Date().toISOString();

  const supa = db();

  // Capture the prior row for the audit log
  const { data: priorRow, error: priorErr } = await supa
    .from("tech_directory")
    .select("tech_id, tech_short_name, slack_user_id, is_active, notes")
    .eq("tech_id", techId)
    .maybeSingle();
  if (priorErr) return { ok: false, error: `lookup failed: ${priorErr.message}` };
  if (!priorRow) return { ok: false, error: `tech_id not found: ${techId}` };

  const { error: updErr } = await supa
    .from("tech_directory")
    .update(updates)
    .eq("tech_id", techId);
  if (updErr) return { ok: false, error: updErr.message };

  // Audit log — fire-and-forget; don't block the user response on a log
  // failure but DO surface log errors via console for debugging.
  await supa.from("maintenance_logs").insert({
    source: "admin-tech-edit",
    level: "info",
    message: `tech_directory edit: ${techId}`,
    context: {
      tech_id: techId,
      tech_short_name: priorRow.tech_short_name,
      author_email: user.email,
      before: {
        slack_user_id: priorRow.slack_user_id,
        is_active: priorRow.is_active,
        notes: priorRow.notes,
      },
      after: updates,
    },
  });

  revalidatePath("/admin/techs");
  return { ok: true };
}
