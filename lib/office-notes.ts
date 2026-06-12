"use server";

// Ambient "office notes" — the always-listening capture MVP (Danny 2026-06-12).
// A continuous recorder (components/AmbientRecorder.tsx) chunks audio into 5-minute
// segments; each is Whisper-transcribed and saved to office_notes. Rule: "if blank
// -> NULL". Music/lyrics count as blank (Whisper drifts on music) -> nulled too.
// Owner-only. Reuses the proven upload-first pipeline (private 'recordings' bucket
// + transcribe-audio Whisper edge fn) from lib/recordings.ts.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";

const BUCKET = "recordings";
const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024; // Whisper hard cap

async function requireOwner() {
  const me = await getCurrentTech();
  if (!me) return { ok: false as const, error: "not signed in" };
  if (!isOwner(me.realEmail)) return { ok: false as const, error: "Office capture is owner-only." };
  return { ok: true as const, me };
}

// Cheap signal-based "is this junk we should null?" filter. Empty -> blank.
// Whisper music/applause tags or heavy line-repetition (lyrics) -> music. The
// robust upgrade is an LLM "conversation vs lyrics?" classify; this catches the
// common cases for free.
function classifyTranscript(raw: string): { keep: boolean; status: string } {
  const s = (raw ?? "").trim();
  if (!s) return { keep: false, status: "blank" };
  if (/^[\s[(]*\b(music|applause|instrumental|silence|inaudible)\b/i.test(s)) return { keep: false, status: "music" };
  if ((s.match(/[♪🎵🎶]/gu)?.length ?? 0) >= 2) return { keep: false, status: "music" };
  const lines = s.split(/[\n.!?]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (lines.length >= 4) {
    const uniq = new Set(lines);
    if (uniq.size * 2 <= lines.length) return { keep: false, status: "music" }; // >=50% repeated lines
  }
  return { keep: true, status: "transcribed" };
}

// 1. Mint a signed upload slot + an office_notes row (status 'uploading').
export async function createOfficeNoteUpload(input: {
  mime?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
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
      source: "office-ambient",
      started_at: input.startedAt ?? null,
      ended_at: input.endedAt ?? null,
      duration_ms: Number(input.durationMs ?? 0) || null,
      transcript_status: "uploading",
      audio_path: path,
    })
    .select("id")
    .single();
  if (insErr || !row) return { ok: false, error: insErr?.message ?? "could not create office note" };

  return { ok: true, id: String(row.id), path: signed.path ?? path, token: signed.token };
}

// 2. Transcribe the uploaded chunk; null + tag if blank/music ("if blank -> NULL").
export async function transcribeOfficeNote(id: string): Promise<{ ok: true; kept: boolean } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const supa = db();

  const { data: rec } = await supa.from("office_notes").select("audio_path").eq("id", id).maybeSingle();
  const audioPath = rec?.audio_path as string | undefined;
  if (!audioPath) return { ok: false, error: "office note not found" };

  const { data: blob, error: dlErr } = await supa.storage.from(BUCKET).download(audioPath);
  if (dlErr || !blob) {
    await supa.from("office_notes").update({ transcript_status: "failed" }).eq("id", id);
    return { ok: false, error: `download: ${dlErr?.message ?? "no file"}` };
  }
  if (blob.size > MAX_TRANSCRIBE_BYTES) {
    await supa.from("office_notes").update({ transcript: null, transcript_status: "too_large" }).eq("id", id);
    return { ok: true, kept: false };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  try {
    const file = new File([blob], `office-${id}.webm`, { type: "audio/webm" });
    const fd = new FormData();
    fd.append("audio", file, file.name);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: fd,
    });
    const out = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !out.ok) {
      await supa.from("office_notes").update({ transcript: null, transcript_status: "failed" }).eq("id", id);
      return { ok: false, error: String(out?.error ?? `transcribe ${res.status}`) };
    }
    const { keep, status } = classifyTranscript(String(out.transcript ?? ""));
    await supa
      .from("office_notes")
      .update({ transcript: keep ? String(out.transcript).trim() : null, transcript_status: status })
      .eq("id", id);
    return { ok: true, kept: keep };
  } catch (e) {
    await supa.from("office_notes").update({ transcript_status: "failed" }).eq("id", id);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    try { await transcribeOfficeNote(id); } catch { /* best-effort */ }
  }
  return { retried: ids.length };
}
