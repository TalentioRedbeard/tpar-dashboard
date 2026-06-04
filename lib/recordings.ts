"use server";

// Save a quick-capture recording (Danny 2026-05-31): upload the audio to the
// PRIVATE 'recordings' bucket + insert a recordings row. Playback is via
// short-lived signed URLs (getRecordingSignedUrl) — never a public link. If
// targeted to Danny, drop a team_note (referencing the recording, no raw URL)
// + a Slack ping. Any signed-in user can record.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { ownerEmail, isOwner } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type SaveRecordingResult = { ok: true; id: string } | { ok: false; error: string };

const TARGETS = ["job", "customer", "estimate", "note_to_danny", "file", "claude"] as const;
const BUCKET = "recordings";

// Resolve a job target the user typed (an HCP invoice/job number, or a job_ id)
// into a canonical hcp_job_id. Techs share invoice numbers, so a number can map
// to 0/1/many jobs — we surface that instead of storing the raw number (the bug
// that orphaned the Charles Cantrell recording, Danny 2026-06-04).
export type ResolveJobResult =
  | { ok: true; hcp_job_id: string; label: string }
  | { ok: false; error: string; matches?: Array<{ hcp_job_id: string; label: string }> };

async function resolveJobRefInternal(input: string): Promise<ResolveJobResult> {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "enter a job number" };
  const supa = db();
  if (raw.startsWith("job_")) {
    const { data } = await supa.from("job_360").select("customer_name, invoice_number").eq("hcp_job_id", raw).maybeSingle();
    return { ok: true, hcp_job_id: raw, label: data ? `${data.customer_name ?? "(job)"} · #${data.invoice_number ?? raw.slice(-6)}` : raw };
  }
  // Treat as an HCP invoice number (with a possible segment, e.g. "27691303-3").
  const cleaned = raw.replace(/[^0-9-]/g, "");
  const trunk = cleaned.split("-")[0];
  if (!trunk) return { ok: false, error: `"${raw}" isn't a job id or invoice number.` };
  const { data } = await supa
    .from("job_360")
    .select("hcp_job_id, customer_name, invoice_number, job_date")
    .or(`invoice_number.eq.${cleaned},invoice_number.eq.${trunk}`)
    .order("job_date", { ascending: false, nullsFirst: false })
    .limit(10);
  const rows = (data ?? []) as Array<{ hcp_job_id: string; customer_name: string | null; invoice_number: string | null; job_date: string | null }>;
  if (rows.length === 0) return { ok: false, error: `No job found for "${raw}". Use the job id (job_…) or record from the job page.` };
  const matches = rows.map((r) => ({
    hcp_job_id: r.hcp_job_id,
    label: `${r.customer_name ?? "(job)"} · #${r.invoice_number ?? cleaned}${r.job_date ? ` · ${String(r.job_date).slice(0, 10)}` : ""}`,
  }));
  if (rows.length === 1) return { ok: true, hcp_job_id: rows[0].hcp_job_id, label: matches[0].label };
  return { ok: false, error: `"${raw}" matches ${rows.length} jobs — open the right one and record from there.`, matches };
}

/** Resolve a typed job id/invoice number for the recorder's confirmation chip. */
export async function resolveJobRef(input: string): Promise<ResolveJobResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  return resolveJobRefInternal(input);
}

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
  const transcript = String(formData.get("transcript") ?? "").trim().slice(0, 8000) || null;

  // Resolve a typed job number → canonical hcp_job_id, and BLOCK on an
  // unresolvable/ambiguous job rather than silently storing a bad ref (the orphan fix).
  let resolvedRef = targetRef;
  if (targetKind === "job" && targetRef && !targetRef.startsWith("job_")) {
    const res = await resolveJobRefInternal(targetRef);
    if (!res.ok) return { ok: false, error: res.error };
    resolvedRef = res.hcp_job_id;
  }

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
      target_ref: resolvedRef,
      audio_path: path,
      audio_url: null, // private bucket — playback via signed URL only
      mime,
      duration_ms: durationMs,
      transcript,
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
        body: `🎤 Voice note${label ? `: ${label}` : ""}${durationMs ? ` (${Math.round(durationMs / 1000)}s)` : ""}${transcript ? `\n\n${transcript}` : ""}`,
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
        body: JSON.stringify({ text: `🎤 *Voice note to Danny from ${from}*${label ? `: ${label}` : ""}${transcript ? `\n> ${transcript.slice(0, 500)}` : "\nOpen your dashboard to play it."}`, context: "voice-note-to-danny" }),
      });
    } catch { /* best-effort */ }
  } else if (targetKind === "claude") {
    // Owner-only: drop a message into the Claude dev-loop queue (claude_messages).
    if (!isOwner(me.realEmail)) return { ok: false, error: "Send to Claude is owner-only." };
    const msg = (transcript || label || "").trim();
    if (!msg) return { ok: false, error: "Nothing to send — the transcript is empty." };
    const { error: qErr } = await supa.from("claude_messages").insert({
      from_email: me.email,
      source: "voice",
      label,
      body: msg.slice(0, 8000),
      recording_id: row.id,
      status: "pending",
    });
    if (qErr) return { ok: false, error: `queue: ${qErr.message}` };
  }

  revalidatePath("/");
  return { ok: true, id: String(row.id) };
}

// Transcribe an audio blob via the transcribe-audio edge fn (Whisper). Called
// right after recording stops, before the user picks what to do with it. The
// recording itself is stored separately by saveRecording.
export async function transcribeRecording(formData: FormData): Promise<{ ok: true; transcript: string } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return { ok: false, error: "no audio captured" };
  if (audio.size > 25 * 1024 * 1024) return { ok: false, error: "recording too large (25MB max)" };

  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  try {
    const fwd = new FormData();
    fwd.append("audio", audio, audio.name || "recording.webm");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: fwd,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) return { ok: false, error: json?.error ?? `transcribe ${res.status}` };
    return { ok: true, transcript: String(json.transcript ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
