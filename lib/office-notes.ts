"use server";

// Ambient "office notes" — the always-listening capture MVP (Danny 2026-06-12).
// A continuous recorder (components/AmbientRecorder.tsx) chunks audio into 5-minute
// segments; each is Whisper-transcribed and saved to office_notes. Rule: "if blank
// -> NULL". Music/lyrics count as blank (Whisper drifts on music) -> nulled too.
// Owner-only. Reuses the proven upload-first pipeline (private 'recordings' bucket)
// from lib/recordings.ts; transcription is on-prem via the VM pull-worker.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";

const BUCKET = "recordings";

async function requireOwner() {
  const me = await getCurrentTech();
  if (!me) return { ok: false as const, error: "not signed in" };
  if (!isOwner(me.realEmail)) return { ok: false as const, error: "Office capture is owner-only." };
  return { ok: true as const, me };
}

// 1. Mint a signed upload slot + an office_notes row (status 'uploading').
export async function createOfficeNoteUpload(input: {
  mime?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  conversationId?: string;   // P2: when set, this chunk belongs to a Start/Stop conversation
  seq?: number;              // chunk order within the conversation
}): Promise<{ ok: true; id: string; path: string; token: string } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const me = gate.me;

  const mime = (input.mime || "audio/webm").split(";")[0];
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : "webm";
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `office/${day}/${Date.now()}-${rand}.${ext}`;

  const supa = db();
  const { data: signed, error: sErr } = await supa.storage.from(BUCKET).createSignedUploadUrl(path);
  if (sErr || !signed?.token) return { ok: false, error: `could not start upload: ${sErr?.message ?? "no token"}` };

  const { data: row, error: insErr } = await supa
    .from("office_notes")
    .insert({
      created_by: me.realEmail ?? me.email,
      source: input.conversationId ? "office-conversation" : "office-ambient",
      started_at: input.startedAt ?? null,
      ended_at: input.endedAt ?? null,
      duration_ms: Number(input.durationMs ?? 0) || null,
      // conversation chunks wait for the finalize worker (stitches + diarizes the whole conversation
      // on Stop); ambient chunks go straight to the per-chunk local lane.
      transcript_status: input.conversationId ? "in_conversation" : "uploading",
      conversation_id: input.conversationId ?? null,
      seq: input.conversationId ? (input.seq ?? 0) : null,
      audio_path: path,
    })
    .select("id")
    .single();
  if (insErr || !row) return { ok: false, error: insErr?.message ?? "could not create office note" };

  return { ok: true, id: String(row.id), path: signed.path ?? path, token: signed.token };
}

// 2. Route this chunk to the ON-PREM transcription lane (P1 record-conversations). The VM pull-worker
// (tpar-transcribe-worker) polls office_notes for transcript_status='pending_local', transcribes
// locally on GPU1, and writes the transcript back — fail-closed, the audio never leaves the building.
// sensitivity='private' since ambient office capture can include non-participants.
export async function markOfficeNotePendingLocal(id: string): Promise<{ ok: boolean }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false };
  const supa = db();
  await supa
    .from("office_notes")
    .update({ transcript_status: "pending_local", transcribe_lane: "local", sensitivity: "private" })
    .eq("id", id);
  return { ok: true };
}

// P2 conversation mode: Start creates a conversation; Stop flips it to 'finalizing' so the VM
// finalize worker stitches its chunks -> transcribe + diarize + merge -> conversation_segments.
export async function startConversation(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const { data, error } = await db()
    .from("conversations")
    .insert({ created_by: gate.me.realEmail ?? gate.me.email, source: "office-conversation", status: "recording", started_at: new Date().toISOString(), sensitivity: "private" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "could not start conversation" };
  return { ok: true, id: String(data.id) };
}

export async function stopConversation(id: string): Promise<{ ok: boolean }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false };
  await db().from("conversations").update({ status: "finalizing", ended_at: new Date().toISOString() }).eq("id", id).eq("status", "recording");
  return { ok: true };
}

// Client-detected pure silence: record the 5-min slot as blank without paying
// Whisper (the voice-activated cost-saver). No audio kept.
export async function saveSilentOfficeNote(input: {
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}): Promise<{ ok: boolean }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false };
  const supa = db();
  await supa.from("office_notes").insert({
    created_by: gate.me.realEmail ?? gate.me.email,
    source: "office-ambient",
    started_at: input.startedAt ?? null,
    ended_at: input.endedAt ?? null,
    duration_ms: Number(input.durationMs ?? 0) || null,
    transcript: null,
    transcript_status: "blank",
  });
  return { ok: true };
}

// Self-heal: re-run transcription for office notes whose audio uploaded but whose
// transcribe step never finished (status still 'uploading'). Called on the recorder's
// mount so stragglers don't sit un-transcribed. Owner-only, bounded.
export async function retranscribePendingOfficeNotes(): Promise<{ retried: number }> {
  const gate = await requireOwner();
  if (!gate.ok) return { retried: 0 };
  const supa = db();
  const { data } = await supa
    .from("office_notes")
    .select("id")
    .eq("transcript_status", "uploading")
    .not("audio_path", "is", null)
    .lt("created_at", new Date(Date.now() - 20000).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    try { await markOfficeNotePendingLocal(id); } catch { /* best-effort */ }
  }
  return { retried: ids.length };
}
