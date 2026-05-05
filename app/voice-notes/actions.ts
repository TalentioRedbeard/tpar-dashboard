"use server";

// Server actions for voice notes — upload, list, generate.
//
// Upload path: form submits a File → we forward as multipart to
// voice-note-upload edge fn (Whisper + tech_voice_notes row).
//
// Generate path: posts reference info to generate-estimate-from-reference.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type UploadVoiceNoteResult =
  | { ok: true; voice_note_id: string; transcript: string; duration_seconds: number | null }
  | { ok: false; error: string };

export async function uploadVoiceNote(formData: FormData): Promise<UploadVoiceNoteResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "Not signed in or no write access." };

  const audio = formData.get("audio") as File | null;
  if (!audio || audio.size === 0) return { ok: false, error: "Audio file required." };

  const hcpJobId      = (formData.get("hcp_job_id") as string | null)?.trim() || null;
  const hcpCustomerId = (formData.get("hcp_customer_id") as string | null)?.trim() || null;
  const intentTag     = (formData.get("intent_tag") as string | null)?.trim() || null;
  const needsDiscussion = formData.get("needs_discussion") === "1";

  // Forward to edge fn as multipart/form-data
  const fwd = new FormData();
  fwd.set("audio", audio, audio.name);
  fwd.set("audio_filename", audio.name || "voice-note");
  fwd.set("audio_mime", audio.type || "audio/webm");
  fwd.set("source", "dashboard");
  fwd.set("user_email", me.email);
  if (me.tech?.tech_short_name) fwd.set("tech_short_name", me.tech.tech_short_name);
  if (me.tech?.hcp_full_name)   fwd.set("tech_full_name", me.tech.hcp_full_name);
  if (hcpJobId)      fwd.set("hcp_job_id", hcpJobId);
  if (hcpCustomerId) fwd.set("hcp_customer_id", hcpCustomerId);
  if (intentTag)     fwd.set("intent_tag", intentTag);
  if (needsDiscussion) fwd.set("needs_discussion", "1");

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/voice-note-upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: fwd,
    });
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json?.ok) {
    return { ok: false, error: String(json?.error ?? `upload returned ${res.status}`) };
  }

  revalidatePath("/voice-notes");
  if (hcpJobId) revalidatePath(`/job/${hcpJobId}`);
  return {
    ok: true,
    voice_note_id: json.voice_note_id as string,
    transcript: (json.transcript as string) ?? "",
    duration_seconds: (json.duration_seconds as number | null) ?? null,
  };
}

export type GenerateResult =
  | { ok: true; output: any; model: string; source_summary: string }
  | { ok: false; error: string };

export async function generateFromReference(input: {
  reference_type: "voice_note" | "line_item" | "freeform_text";
  reference_id?: string;
  reference_text?: string;
  hcp_job_id?: string;
  hcp_customer_id?: string;
  target_scope: "single_line_item" | "full_option_set" | "add_to_option";
  existing_option_summary?: string;
  extra_instructions?: string;
}): Promise<GenerateResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isAdmin && !me?.isManager) {
    return { ok: false, error: "Not signed in or insufficient access." };
  }

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/generate-estimate-from-reference`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json?.ok) {
    return { ok: false, error: String(json?.error ?? `generator returned ${res.status}`) };
  }
  return {
    ok: true,
    output: json.output,
    model: json.model as string,
    source_summary: json.source_summary as string,
  };
}

export async function listVoiceNotesForJob(hcpJobId: string) {
  const supa = db();
  const { data } = await supa
    .from("tech_voice_notes")
    .select("id, ts, source, tech_short_name, user_email, transcript, transcription_status, audio_duration_seconds, intent_tag")
    .eq("hcp_job_id", hcpJobId)
    .order("ts", { ascending: false })
    .limit(20);
  return data ?? [];
}

export async function listRecentVoiceNotes(limit = 30) {
  const supa = db();
  const { data } = await supa
    .from("tech_voice_notes")
    .select("id, ts, source, tech_short_name, user_email, hcp_job_id, hcp_customer_id, transcript, transcription_status, audio_duration_seconds, intent_tag")
    .order("ts", { ascending: false })
    .limit(limit);
  return data ?? [];
}
