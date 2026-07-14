"use server";

// Timecard adjudication verbs (plan 2026-07-13 section 2.4). The sync fn
// stays the only writer of timecard_sync_*; these actions write ONLY
// timecard_reviews / timecard_week_reviews / (for Accept-HCP) a void on the
// disputed tech-web entry — void never delete, and never an hcp-mirror row.
// There is deliberately NO verb that edits a time: fabricating a punch stays
// impossible. Escalation default per decision #9: conflicts go to Danny with
// the side-by-side; the flag mechanism carries them.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { requireManagement } from "@/lib/current-tech";

export type TimecardVerbResult = { ok: true; healed?: boolean } | { ok: false; error: string };

export async function adjudicateTimecardEntry(input: {
  hcpEmployeeId: string;
  techShortName: string | null;
  workDate: string; // YYYY-MM-DD
  entryId: string;  // tech_time_entries.id (uuid)
  verb: "accept_hcp" | "keep_app";
  note?: string;
}): Promise<TimecardVerbResult> {
  const auth = await requireManagement();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!input.hcpEmployeeId || !/^\d{4}-\d{2}-\d{2}$/.test(input.workDate) || !input.entryId) {
    return { ok: false, error: "Missing conflict identifiers." };
  }

  const supa = db();

  // The decision row — latest ruling wins on the natural key (a changed mind
  // re-records with fresh decided_by/at; history is the audit trail in HCP +
  // the voided entry itself).
  const { error: revErr } = await supa
    .from("timecard_reviews")
    .upsert(
      {
        hcp_employee_id: input.hcpEmployeeId,
        tech_short_name: input.techShortName,
        work_date: input.workDate,
        entry_id: input.entryId,
        decision: input.verb,
        note: input.note?.trim() || null,
        decided_by: auth.email,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "hcp_employee_id,work_date,entry_id" },
    );
  if (revErr) return { ok: false, error: revErr.message };

  if (input.verb === "accept_hcp") {
    // Void the disputed tech-web entry so it leaves matching; the sync then
    // self-clears the day to in_sync on its next pass (runs 3×/day). Guards:
    // only tech-web rows, only un-voided ones — the sync's hcp-mirror rows
    // are never touched from here.
    const { data: voided, error: voidErr } = await supa
      .from("tech_time_entries")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: auth.email,
        void_reason: `timecard review: HCP accepted for ${input.workDate}`,
      })
      .eq("id", input.entryId)
      .eq("source", "tech-web")
      .is("voided_at", null)
      .select("id")
      .maybeSingle();
    if (voidErr) return { ok: false, error: `Review recorded, but the void failed: ${voidErr.message}` };
    if (!voided) {
      return { ok: false, error: "Review recorded, but that entry wasn't voidable (already voided, or not a tech-web entry)." };
    }
  }

  revalidatePath("/manage/timecards");
  return { ok: true, healed: input.verb === "accept_hcp" };
}

// "Bring to Danny" — not a ruling: raises a timecard_conflict flag routed
// straight to in_review/Danny (decision #9), leaving the entry needs-review.
export async function escalateTimecardConflict(input: {
  hcpEmployeeId: string;
  techShortName: string | null;
  workDate: string;
  summary: string; // the side-by-side, prebuilt by the page
}): Promise<TimecardVerbResult> {
  const auth = await requireManagement();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { error } = await db().from("data_flags").insert({
    entity_type: "timecard_day",
    entity_id: `${input.hcpEmployeeId}:${input.workDate}`,
    entity_label: `${input.techShortName ?? input.hcpEmployeeId} · ${input.workDate}`,
    flag_type: "timecard_conflict",
    status: "in_review",
    assigned_to: "ddunlop@tulsapar.com",
    note: input.summary.slice(0, 2000),
    source: "human",
    created_by: auth.email,
  });
  if (error) {
    // 23505 = an open flag for this day already exists — that's fine, it's
    // already with Danny.
    if ((error as { code?: string }).code === "23505") {
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/manage/timecards");
  return { ok: true };
}

export async function markWeekReviewed(input: {
  weekStart: string; // YYYY-MM-DD, Sunday
  note?: string;
}): Promise<TimecardVerbResult> {
  const auth = await requireManagement();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart)) return { ok: false, error: "Bad week." };

  const { error } = await db().from("timecard_week_reviews").insert({
    week_start: input.weekStart,
    reviewed_by: auth.email,
    note: input.note?.trim() || null,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "This week already carries a review signature." };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/manage/timecards");
  return { ok: true };
}
