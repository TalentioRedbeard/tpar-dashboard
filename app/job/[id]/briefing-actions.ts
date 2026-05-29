"use server";

// Job Briefing — the owner/dispatcher's pre-job voice note (intent_tag
// 'job-note'), elevated so the assigned tech reviews it before heading out /
// calling the customer. The review is tracked per tech in job_briefing_reviews
// and tied to the specific voice note, so an updated briefing needs a fresh
// review.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Briefing = {
  voiceNoteId: string;
  transcript: string;
  authorShortName: string | null;
  authorEmail: string | null;
  ts: string;
  durationSeconds: number | null;
  reviewedByMe: boolean;
  reviewedByMeAt: string | null;
};

// Effective (impersonation-aware) reviewer email — matches the inbox pattern.
async function reviewerEmail(): Promise<string | null> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return null;
  return (me.tech?.email ?? me.email).toLowerCase();
}

export async function getBriefingForJob(hcpJobId: string): Promise<Briefing | null> {
  const supa = db();
  const { data: notes } = await supa
    .from("tech_voice_notes")
    .select("id, ts, tech_short_name, user_email, transcript, audio_duration_seconds, intent_tag")
    .eq("hcp_job_id", hcpJobId)
    .eq("intent_tag", "job-note")
    .not("transcript", "is", null)
    .order("ts", { ascending: false })
    .limit(1);
  const note = notes?.[0];
  if (!note || !note.transcript || !String(note.transcript).trim()) return null;

  const voiceNoteId = String(note.id);
  let reviewedByMe = false;
  let reviewedByMeAt: string | null = null;
  const email = await reviewerEmail();
  if (email) {
    const { data: rev } = await supa
      .from("job_briefing_reviews")
      .select("reviewed_at")
      .eq("voice_note_id", voiceNoteId)
      .eq("reviewed_by_email", email)
      .maybeSingle();
    if (rev) { reviewedByMe = true; reviewedByMeAt = rev.reviewed_at as string; }
  }

  return {
    voiceNoteId,
    transcript: note.transcript as string,
    authorShortName: (note.tech_short_name as string | null) ?? null,
    authorEmail: (note.user_email as string | null) ?? null,
    ts: note.ts as string,
    durationSeconds: (note.audio_duration_seconds as number | null) ?? null,
    reviewedByMe,
    reviewedByMeAt,
  };
}

export async function markBriefingReviewed(hcpJobId: string, voiceNoteId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "not signed in" };
  const email = (me.tech?.email ?? me.email).toLowerCase();
  const { error } = await db()
    .from("job_briefing_reviews")
    .upsert(
      {
        hcp_job_id: hcpJobId,
        voice_note_id: voiceNoteId,
        reviewed_by_email: email,
        reviewed_by_short_name: me.tech?.tech_short_name ?? null,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "voice_note_id,reviewed_by_email" },
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/job/${hcpJobId}`);
  revalidatePath("/me");
  return { ok: true };
}
