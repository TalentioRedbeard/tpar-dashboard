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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4"))  return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav"))  return "wav";
  if (mime.includes("ogg"))  return "ogg";
  if (mime.includes("aac"))  return "aac";
  if (mime.includes("m4a"))  return "m4a";
  return "audio";
}

export type UploadVoiceNoteResult =
  | { ok: true; voice_note_id: string; transcript: string; duration_seconds: number | null }
  | { ok: false; error: string };

// Transcription is on-prem now (P5): voice-note-upload returns immediately with the row
// marked 'pending_local', and the VM worker fills the transcript. Poll briefly so short
// notes (the norm) still come back with the transcript inline — but never block hard. If the
// VM is slow/down, we return an empty transcript + the note still appears (worker fills it).
async function pollVoiceNoteTranscript(
  id: string,
  maxMs = 24_000,
): Promise<{ transcript: string; status: string | null; duration: number | null }> {
  const supa = db();
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { data } = await supa
      .from("tech_voice_notes")
      .select("transcript, transcription_status, audio_duration_seconds")
      .eq("id", id)
      .maybeSingle();
    const status = (data?.transcription_status as string) ?? null;
    const transcript = (data?.transcript as string) ?? "";
    if ((transcript && transcript.trim()) || ["transcribed", "blank", "failed"].includes(status ?? "")) {
      return { transcript, status, duration: (data?.audio_duration_seconds as number | null) ?? null };
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return { transcript: "", status: "pending_local", duration: null };
}

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

  const fwdUrl = `${SUPABASE_URL}/functions/v1/voice-note-upload`;
  let res: Response;
  try {
    res = await fetch(fwdUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: fwd,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const msg = `network: ${e instanceof Error ? e.message : String(e)}`;
    try {
      await db().from("maintenance_logs").insert({
        source: "dashboard-voice-note-upload", level: "error",
        message: msg,
        context: { fwd_url: fwdUrl, author_email: me.email, hcp_job_id: hcpJobId, audio_size: audio.size, audio_type: audio.type },
      });
    } catch { /* ignore */ }
    return { ok: false, error: msg };
  }
  const bodyText = await res.text();
  let json: any = {};
  try { json = JSON.parse(bodyText); } catch { /* keep body for log */ }
  if (!res.ok || !json?.ok) {
    const msg = String(json?.error ?? `upload returned ${res.status}`);
    try {
      await db().from("maintenance_logs").insert({
        source: "dashboard-voice-note-upload", level: "error",
        message: msg,
        context: {
          fwd_url: fwdUrl, http_status: res.status,
          response_body: bodyText.slice(0, 800),
          author_email: me.email, hcp_job_id: hcpJobId,
          audio_size: audio.size, audio_type: audio.type,
        },
      });
    } catch { /* ignore */ }
    return { ok: false, error: msg };
  }

  const voiceId = json.voice_note_id as string;
  const polled = await pollVoiceNoteTranscript(voiceId);
  revalidatePath("/voice-notes");
  if (hcpJobId) revalidatePath(`/job/${hcpJobId}`);
  return {
    ok: true,
    voice_note_id: voiceId,
    transcript: polled.transcript,
    duration_seconds: polled.duration,
  };
}

// ── Upload-first path (2026-06-08) ───────────────────────────────────────────
// The browser PUTs the audio DIRECTLY to the voice-notes bucket via a signed
// upload URL, bypassing Vercel's ~4.5MB server-action body cap that dropped long
// notes (see reference_vercel_body_cap). createVoiceNoteUpload mints the slot;
// finalizeVoiceNote then calls the voice-note-upload edge fn in JSON mode (the
// binary never crosses a server action — only the small path/metadata does).

export type CreateVoiceNoteUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

export async function createVoiceNoteUpload(input: { mime?: string }): Promise<CreateVoiceNoteUploadResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "Not signed in or no write access." };
  const mime = (input.mime || "audio/webm").split(";")[0];
  const ext = extFromMime(mime);
  const dateSlug = new Date().toISOString().slice(0, 10);
  const path = `${dateSlug}/${crypto.randomUUID()}.${ext}`;
  const { data: signed, error } = await db().storage.from("voice-notes").createSignedUploadUrl(path);
  if (error || !signed?.token) return { ok: false, error: `Could not start upload: ${error?.message ?? "no token"}` };
  return { ok: true, path: signed.path ?? path, token: signed.token };
}

export async function finalizeVoiceNote(input: {
  audio_path: string;
  audio_filename?: string;
  audio_mime?: string;
  hcp_job_id?: string | null;
  hcp_customer_id?: string | null;
  intent_tag?: string | null;
  needs_discussion?: boolean;
}): Promise<UploadVoiceNoteResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "Not signed in or no write access." };
  const audioPath = String(input.audio_path ?? "").trim();
  if (!audioPath) return { ok: false, error: "Missing audio path." };

  const hcpJobId = input.hcp_job_id?.trim() || null;
  const payload: Record<string, unknown> = {
    audio_path: audioPath,
    audio_filename: input.audio_filename || "voice-note.webm",
    audio_mime: input.audio_mime || "audio/webm",
    source: "dashboard",
    user_email: me.email,
  };
  if (me.tech?.tech_short_name) payload.tech_short_name = me.tech.tech_short_name;
  if (me.tech?.hcp_full_name)   payload.tech_full_name = me.tech.hcp_full_name;
  if (hcpJobId)                 payload.hcp_job_id = hcpJobId;
  if (input.hcp_customer_id?.trim()) payload.hcp_customer_id = input.hcp_customer_id.trim();
  if (input.intent_tag?.trim())  payload.intent_tag = input.intent_tag.trim();
  if (input.needs_discussion)    payload.needs_discussion = "1";

  const fwdUrl = `${SUPABASE_URL}/functions/v1/voice-note-upload`;
  let res: Response;
  try {
    res = await fetch(fwdUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const msg = `network: ${e instanceof Error ? e.message : String(e)}`;
    try {
      await db().from("maintenance_logs").insert({
        source: "dashboard-voice-note-upload", level: "error", message: msg,
        context: { fwd_url: fwdUrl, mode: "json", author_email: me.email, hcp_job_id: hcpJobId, audio_path: audioPath },
      });
    } catch { /* ignore */ }
    return { ok: false, error: msg };
  }
  const bodyText = await res.text();
  let json: any = {};
  try { json = JSON.parse(bodyText); } catch { /* keep body for log */ }
  if (!res.ok || !json?.ok) {
    const msg = String(json?.error ?? `upload returned ${res.status}`);
    try {
      await db().from("maintenance_logs").insert({
        source: "dashboard-voice-note-upload", level: "error", message: msg,
        context: {
          fwd_url: fwdUrl, mode: "json", http_status: res.status,
          response_body: bodyText.slice(0, 800),
          author_email: me.email, hcp_job_id: hcpJobId, audio_path: audioPath,
        },
      });
    } catch { /* ignore */ }
    return { ok: false, error: msg };
  }

  const voiceId = json.voice_note_id as string;
  const polled = await pollVoiceNoteTranscript(voiceId);
  revalidatePath("/voice-notes");
  if (hcpJobId) revalidatePath(`/job/${hcpJobId}`);
  return {
    ok: true,
    voice_note_id: voiceId,
    transcript: polled.transcript,
    duration_seconds: polled.duration,
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
