"use server";

// Save a quick-capture recording (Danny 2026-05-31): upload the audio to the
// PRIVATE 'recordings' bucket + insert a recordings row. Playback is via
// short-lived signed URLs (getRecordingSignedUrl) — never a public link. If
// targeted to Danny, drop a team_note (referencing the recording, no raw URL)
// + a Slack ping. Any signed-in user can record.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { ownerEmail } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type SaveRecordingResult = { ok: true; id: string } | { ok: false; error: string };

const TARGETS = ["job", "customer", "estimate", "note_to_danny", "file"] as const;
const BUCKET = "recordings";

export async function saveRecording(formData: FormData): Promise<SaveRecordingResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };

  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return { ok: false, error: "no audio captured" };
  if (audio.size > 25 * 1024 * 1024) return { ok: false, error: "recording too large (25MB max)" };

  const label = String(formData.get("label") ?? "").trim().slice(0, 200) || null;
  const tkRaw = String(formData.get("target_kind") ?? "file").trim();
  const targetKind = (TARGETS as readonly string[]).includes(tkRaw) ? tkRaw : "file";
  const targetRef = String(formData.get("target_ref") ?? "").trim() || null;
  const durationMs = Number(formData.get("duration_ms") ?? 0) || null;

  const mime = audio.type || "audio/webm";
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
  const who = (me.tech?.tech_short_name ?? me.email.split("@")[0]).replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${who}/${Date.now()}-${rand}.${ext}`;

  const supa = db();
  const buf = Buffer.from(await audio.arrayBuffer());
  const { error: upErr } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) return { ok: false, error: `upload failed: ${upErr.message}` };

  const { data: row, error: insErr } = await supa
    .from("recordings")
    .insert({
      label,
      target_kind: targetKind,
      target_ref: targetRef,
      audio_path: path,
      audio_url: null, // private bucket — playback via signed URL only
      mime,
      duration_ms: durationMs,
      created_by: me.tech?.tech_short_name ?? me.email,
    })
    .select("id")
    .single();
  if (insErr || !row) return { ok: false, error: insErr?.message ?? "save failed" };

  // Targeted to Danny → team_note referencing the recording (id, not a URL) +
  // Slack ping (no raw link). Inlined so techs can use it too.
  if (targetKind === "note_to_danny") {
    try {
      await supa.from("team_notes").insert({
        author_email: me.email,
        author_short_name: me.tech?.tech_short_name ?? null,
        target_kind: "teammate",
        target_email: ownerEmail(),
        target_short_name: "Danny",
        body: `🎤 Voice note${label ? `: ${label}` : ""}${durationMs ? ` (${Math.round(durationMs / 1000)}s)` : ""}`,
        attach_kind: null,
        attach_ref: String(row.id),
        tags: ["note-to-danny", "voice"],
        urgent: false,
      });
      const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const from = me.tech?.tech_short_name ?? me.email.split("@")[0];
      await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Trigger-Secret": process.env.NOTIFY_DANNY_SECRET ?? "" },
        body: JSON.stringify({ text: `🎤 *Voice note to Danny from ${from}*${label ? `: ${label}` : ""}\nOpen your dashboard to play it.`, context: "voice-note-to-danny" }),
      });
    } catch { /* best-effort */ }
  }

  revalidatePath("/");
  return { ok: true, id: String(row.id) };
}

// Short-lived signed URL for playing a recording. Signed-in users only; the
// audio is otherwise inaccessible (private bucket).
export async function getRecordingSignedUrl(recordingId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const supa = db();
  const { data: rec } = await supa.from("recordings").select("audio_path").eq("id", recordingId).maybeSingle();
  const audioPath = rec?.audio_path as string | undefined;
  if (!audioPath) return { ok: false, error: "recording not found" };
  const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(audioPath, 3600);
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? "could not sign url" };
  return { ok: true, url: data.signedUrl };
}
