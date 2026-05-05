"use server";

// Server actions for /admin/concerns. Surfaces voice notes flagged for
// discussion (needs_discussion=true, discussion_resolved_at IS NULL),
// optionally filtered by intent_tag.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Concern = {
  id: string;
  ts: string;
  source: string;
  user_email: string | null;
  tech_short_name: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  transcript: string | null;
  intent_tag: string | null;
  audio_duration_seconds: number | null;
  subject_tags: string[] | null;
};

export async function listOpenConcerns(): Promise<Concern[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return [];
  const supa = db();
  const { data } = await supa
    .from("tech_voice_notes")
    .select("id, ts, source, user_email, tech_short_name, hcp_job_id, hcp_customer_id, transcript, intent_tag, audio_duration_seconds, subject_tags")
    .eq("needs_discussion", true)
    .is("discussion_resolved_at", null)
    .order("ts", { ascending: false })
    .limit(100);
  return (data ?? []) as Concern[];
}

export async function listResolvedConcerns(limit = 25): Promise<Concern[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return [];
  const supa = db();
  const { data } = await supa
    .from("tech_voice_notes")
    .select("id, ts, source, user_email, tech_short_name, hcp_job_id, hcp_customer_id, transcript, intent_tag, audio_duration_seconds, subject_tags, discussion_resolved_at, discussion_resolution")
    .eq("needs_discussion", true)
    .not("discussion_resolved_at", "is", null)
    .order("discussion_resolved_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as any;
}

export async function resolveConcern(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return { ok: false, error: "leadership only" };
  const id = (formData.get("id") as string | null)?.trim();
  const resolution = (formData.get("resolution") as string | null)?.trim() || null;
  if (!id) return { ok: false, error: "missing id" };
  const supa = db();
  const { error } = await supa
    .from("tech_voice_notes")
    .update({
      discussion_resolved_at: new Date().toISOString(),
      discussion_resolution: resolution,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/concerns");
  return { ok: true };
}
