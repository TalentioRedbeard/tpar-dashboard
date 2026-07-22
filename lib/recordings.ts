"use server";

// Quick-capture recordings — UPLOAD-FIRST durability (Danny 2026-06-08, replacing
// the 2026-05-31 server-action save that lost long recordings to Vercel's ~4.5MB
// request-body cap). Flow:
//   1. createRecordingUpload  → mint a signed Storage upload URL + insert the
//      recordings row (status='uploading'); returns { id, path, token }.
//   2. browser uploads the blob DIRECTLY to the private 'recordings' bucket via
//      storage.uploadToSignedUrl (bypasses Vercel entirely — no size cap).
//   3. markRecordingStored    → status='stored' (the audio is now durable).
//   4. markRecordingPendingLocal → flips the row to 'pending_local'; the on-prem VM
//      worker transcribes locally + writes back (no-clobber). Never gates the save.
//   5. finalizeRecording      → attach label/transcript/target (+ note-to-Danny /
//      Claude side-effects); runs the job-ref guard (the Cantrell orphan fix).
//   6. discardRecording       → delete the object + row if not yet finalized.
// Audio is durable from step 3 on, even if the user never finalizes — the row is
// recoverable/attachable in Studio. Playback is via short-lived signed URLs.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { getSessionUser } from "@/lib/supabase-server";
import { ownerEmail, isOwner } from "@/lib/admin";
import { revalidatePath } from "next/cache";
import type { MyCapture } from "@/lib/capture-types";

export type SaveRecordingResult = { ok: true; id: string } | { ok: false; error: string };

// 'daily-wrap' = tech end-of-day verbal wrap (DailyWrapCard on /me); the DB check
// constraint allows it (migration 20260705203401) and tech-wrap-distill sweeps it.
const TARGETS = ["job", "customer", "estimate", "note_to_danny", "file", "claude", "daily-wrap"] as const;
const BUCKET = "recordings";

type Me = NonNullable<Awaited<ReturnType<typeof getCurrentTech>>>;
// Stable identity used for created_by + ownership checks within a session.
function whoIdentity(me: Me): string {
  return me.tech?.tech_short_name ?? me.email;
}

// ── Job-ref guard (the Charles Cantrell orphan fix) ─────────────────────────
// Resolve a job target the user typed (an HCP invoice/job number, or a job_ id)
// into a canonical hcp_job_id. Techs share invoice numbers, so a number can map
// to 0/1/many jobs — we surface that instead of storing the raw number.
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

// ── 1. Create the upload slot (row-first + signed upload URL) ────────────────
export async function createRecordingUpload(
  input: { mime?: string; durationMs?: number },
): Promise<{ ok: true; id: string; path: string; token: string } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  // Stable owner = the REAL signed-in user's auth uid. getSessionUser() reads the
  // auth session directly, so this is the actual person even under view-as (an
  // admin recording while impersonating a tech owns it AS the admin — intended).
  const sess = await getSessionUser().catch(() => null);

  const mime = (input.mime || "audio/webm").split(";")[0];
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : "webm";
  const who = whoIdentity(me).replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${who}/${Date.now()}-${rand}.${ext}`;

  const supa = db();
  const { data: signed, error: sErr } = await supa.storage.from(BUCKET).createSignedUploadUrl(path);
  if (sErr || !signed?.token) return { ok: false, error: `could not start upload: ${sErr?.message ?? "no token"}` };

  const { data: row, error: insErr } = await supa
    .from("recordings")
    .insert({
      audio_path: path,
      audio_url: null, // private bucket — playback via signed URL only
      mime,
      duration_ms: Number(input.durationMs ?? 0) || null,
      status: "uploading",
      target_kind: null, // unfiled until finalizeRecording
      created_by: whoIdentity(me),       // display label only — collision-prone
      created_by_uid: sess?.id ?? null,  // stable owner key (see Segment 0)
    })
    .select("id")
    .single();
  if (insErr || !row) return { ok: false, error: insErr?.message ?? "could not create recording" };

  return { ok: true, id: String(row.id), path: signed.path ?? path, token: signed.token };
}

// ── 3. Confirm the bytes landed in the bucket → the audio is durable ─────────
export async function markRecordingStored(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const supa = db();
  const { error } = await supa
    .from("recordings")
    .update({ status: "stored" })
    .eq("id", id)
    .eq("created_by", whoIdentity(me));
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── 4. On-prem transcription lane (P5 record-conversations) ──────────────────
// Route this recording to the VM instead of cloud Whisper: flip it to 'pending_local'
// and the on-prem pull-worker (tpar-transcribe-worker) transcribes it on GPU1 and writes
// the transcript back — fail-closed, the audio never leaves the building. requestTranscription
// (above) stays as a non-default cloud fallback. The worker no-clobbers a user-typed transcript.
export async function markRecordingPendingLocal(id: string): Promise<{ ok: boolean }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false };
  const supa = db();
  await supa
    .from("recordings")
    .update({ transcript_status: "pending_local", transcribe_lane: "local", sensitivity: "private" })
    .eq("id", id);
  return { ok: true };
}

// Poll helper: the recorder uses this to show the on-prem transcript inline if it lands
// while the user is still in the review card (best-effort — saving early is fine, the
// worker fills it afterward). Returns the current status + transcript.
export async function getRecordingTranscript(id: string): Promise<{ status: string | null; transcript: string | null }> {
  const me = await getCurrentTech();
  if (!me) return { status: null, transcript: null };
  const { data } = await db().from("recordings").select("transcript_status, transcript").eq("id", id).maybeSingle();
  return { status: (data?.transcript_status as string) ?? null, transcript: (data?.transcript as string) ?? null };
}

// ── 5. Finalize: attach metadata + run targets' side-effects ─────────────────
export async function finalizeRecording(input: {
  id: string;
  label?: string;
  transcript?: string;
  targetKind: string;
  targetRef?: string;
}): Promise<SaveRecordingResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const sess = await getSessionUser().catch(() => null);
  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, error: "missing recording id" };
  const supa = db();

  const { data: rec } = await supa.from("recordings").select("id, created_by_uid, status, duration_ms").eq("id", id).maybeSingle();
  if (!rec) return { ok: false, error: "recording not found" };
  // Ownership on the STABLE created_by_uid (not the collision-prone display name) —
  // consistent with refile/discard/getRecordingSignedUrl.
  const mine = !!sess?.id && rec.created_by_uid === sess.id;
  if (!mine && !me.isAdmin && !me.isManager) return { ok: false, error: "not your recording" };
  if (rec.status !== "stored") return { ok: false, error: "audio is still uploading — give it a moment" };

  const label = String(input.label ?? "").trim().slice(0, 200) || null;
  const tkRaw = String(input.targetKind ?? "file").trim();
  const targetKind = (TARGETS as readonly string[]).includes(tkRaw) ? tkRaw : "file";
  const transcriptText = String(input.transcript ?? "").trim().slice(0, 8000); // "" if none yet
  const transcript = transcriptText || null;

  // Validate target-specific preconditions BEFORE mutating the row.
  if (targetKind === "claude") {
    if (!isOwner(me.realEmail)) return { ok: false, error: "Send to Claude is owner-only." };
    if (!(transcriptText || label)) return { ok: false, error: "Nothing to send — add a transcript or label." };
  }

  // Resolve a typed job number → canonical hcp_job_id, blocking on ambiguity (the orphan fix).
  let resolvedRef = String(input.targetRef ?? "").trim() || null;
  if (targetKind === "job" && resolvedRef && !resolvedRef.startsWith("job_")) {
    const res = await resolveJobRefInternal(resolvedRef);
    if (!res.ok) return { ok: false, error: res.error };
    resolvedRef = res.hcp_job_id;
  }

  // Only write transcript when the user actually has text — otherwise a Save that
  // lands before the auto-transcript returns would null out a long clip's transcript
  // (requestTranscription's write-back only guards an empty row, not an overwrite).
  const patch: Record<string, unknown> = {
    label,
    target_kind: targetKind,
    target_ref: resolvedRef,
    finalized_at: new Date().toISOString(),
  };
  if (transcriptText) patch.transcript = transcriptText;
  // Pin harvestable lanes so the 30-day audio-retention sweep never reclaims them —
  // these are the voice-ID enrollment seeds + real work product (Danny 2026-07-20).
  // Estimate joined the pin list 2026-07-21 (Studio Seg 2) so an estimate-attached
  // capture's audio is permanent too. Ambient/file/claude stay on the default window.
  if (["daily-wrap", "job", "note_to_danny", "customer", "estimate"].includes(targetKind)) patch.keep_audio = true;

  // Idempotency: only the FIRST finalize (finalized_at still null) writes + fires
  // side-effects. A double-tap inside the ~900ms reset window updates zero rows
  // and returns ok without duplicating the note / Slack / Claude inserts.
  const { data: updated, error: updErr } = await supa
    .from("recordings")
    .update(patch)
    .eq("id", id)
    .is("finalized_at", null)
    .select("id");
  if (updErr) return { ok: false, error: updErr.message };
  if (!updated || updated.length === 0) return { ok: true, id }; // already finalized — skip side-effects

  // Targeted to Danny → team_note (id, not a URL) + Slack ping. Best-effort.
  if (targetKind === "note_to_danny") {
    try {
      const durMs = Number(rec.duration_ms ?? 0);
      await supa.from("team_notes").insert({
        author_email: me.email,
        author_short_name: me.tech?.tech_short_name ?? null,
        target_kind: "teammate",
        target_email: ownerEmail(),
        target_short_name: "Danny",
        body: `🎤 Voice note${label ? `: ${label}` : ""}${durMs ? ` (${Math.round(durMs / 1000)}s)` : ""}${transcript ? `\n\n${transcript}` : ""}`,
        attach_kind: null,
        attach_ref: id,
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
    // Owner-only dev-loop queue (validated above).
    const msg = (transcript || label || "").trim();
    const { error: qErr } = await supa.from("claude_messages").insert({
      from_email: me.email,
      source: "voice",
      label,
      body: msg.slice(0, 8000),
      recording_id: id,
      status: "pending",
    });
    if (qErr) return { ok: false, error: `queue: ${qErr.message}` };
  }

  revalidatePath("/");
  return { ok: true, id };
}

// ── "My Captures" tray (Danny 2026-07-21) ──────────────────────────────────
// The fix for "I recorded it and can't find it anywhere": a recording saves fine
// (target_kind='customer'/'job'/…) but no tech-facing surface listed a tech's OWN
// recordings. This lists them on /me, transcript-status-agnostic (the on-prem
// transcript lands async and must never hide a saved capture), with actions to
// turn one into an estimate or re-file it to a job.
const CAPTURE_SELECT = "id, created_at, duration_ms, label, transcript, transcript_status, target_kind, target_ref, status";
type CapRow = {
  id: string; created_at: string; duration_ms: number | null; label: string | null;
  transcript: string | null; transcript_status: string | null;
  target_kind: string | null; target_ref: string | null; status: string | null;
};

// Resolve customer display names + map rows → MyCapture. Shared by the /me card
// and the Studio hub so the labeling stays identical.
async function mapCaptureRows(supa: ReturnType<typeof db>, rows: CapRow[]): Promise<MyCapture[]> {
  const cusIds = [...new Set(rows.filter((r) => r.target_kind === "customer" && r.target_ref).map((r) => r.target_ref as string))];
  const nameById = new Map<string, string>();
  if (cusIds.length) {
    const { data: cs } = await supa
      .from("hcp_customers_raw")
      .select("hcp_customer_id, first_name, last_name, company")
      .in("hcp_customer_id", cusIds);
    for (const c of (cs ?? []) as Array<{ hcp_customer_id: string; first_name: string | null; last_name: string | null; company: string | null }>) {
      const nm = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.company || "Customer";
      nameById.set(c.hcp_customer_id, nm);
    }
  }
  return rows.map((r): MyCapture => {
    let filedLabel = "Unfiled";
    let customer_id: string | null = null;
    if (r.target_kind === "customer" && r.target_ref) { customer_id = r.target_ref; filedLabel = `Customer · ${nameById.get(r.target_ref) ?? "—"}`; }
    else if (r.target_kind === "job" && r.target_ref) filedLabel = `Job #${r.target_ref.slice(-6)}`;
    else if (r.target_kind === "estimate") filedLabel = "Estimate";
    else if (r.target_kind === "note_to_danny") filedLabel = "Note to Danny";
    else if (r.target_kind && r.target_kind !== "file") filedLabel = r.target_kind;
    return {
      id: r.id, created_at: r.created_at, duration_ms: r.duration_ms, label: r.label,
      transcript: r.transcript, transcript_status: r.transcript_status,
      target_kind: r.target_kind, target_ref: r.target_ref, customer_id, filedLabel,
    };
  });
}

export async function listMyRecentCaptures(): Promise<MyCapture[]> {
  const me = await getCurrentTech();
  if (!me?.tech) return [];
  // Scope on the STABLE owner uid (Studio Seg 0/1), not the collision-prone
  // display name — a 2nd "Chris" must never see the first's captures.
  const sess = await getSessionUser().catch(() => null);
  if (!sess?.id) return [];
  const supa = db();
  const { data } = await supa
    .from("recordings")
    .select(CAPTURE_SELECT)
    .eq("created_by_uid", sess.id)
    .eq("status", "stored")
    .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(25);
  // Daily wraps have their own card; the Claude dev-loop is owner-only — drop both.
  const rows = ((data ?? []) as CapRow[]).filter((r) => r.target_kind !== "daily-wrap" && r.target_kind !== "claude");
  return mapCaptureRows(supa, rows);
}

// Studio hub (Seg 1) — creator-scoped, split into the two-state model:
//   inbox = unassigned (stored, not filed, no target_kind) — clears at 3 days
//   filed = assigned/finalized (permanent) — excl. daily-wrap + claude
// Scoped on created_by_uid; NEVER reuses the leadership all-company search.
export async function listMyStudioCaptures(): Promise<{ inbox: MyCapture[]; filed: MyCapture[] }> {
  const me = await getCurrentTech();
  if (!me) return { inbox: [], filed: [] };
  const sess = await getSessionUser().catch(() => null);
  if (!sess?.id) return { inbox: [], filed: [] };
  const supa = db();
  const [inboxRes, filedRes] = await Promise.all([
    supa.from("recordings").select(CAPTURE_SELECT)
      .eq("created_by_uid", sess.id).eq("status", "stored")
      .is("finalized_at", null).is("target_kind", null)
      .order("created_at", { ascending: false }).limit(50),
    // Filed = has a target_kind (the exact complement of the inbox's target_kind
    // IS NULL). NOT keyed on finalized_at: refileCapture files a capture by setting
    // target_kind without finalized_at, so keying on finalized_at would drop a
    // just-refiled capture out of BOTH lists (it vanishes from the hub).
    supa.from("recordings").select(CAPTURE_SELECT)
      .eq("created_by_uid", sess.id).eq("status", "stored").not("target_kind", "is", null)
      .order("created_at", { ascending: false }).limit(100),
  ]);
  const inboxRows = (inboxRes.data ?? []) as CapRow[];
  const filedRows = ((filedRes.data ?? []) as CapRow[]).filter((r) => r.target_kind !== "daily-wrap" && r.target_kind !== "claude");
  const [inbox, filed] = await Promise.all([mapCaptureRows(supa, inboxRows), mapCaptureRows(supa, filedRows)]);
  return { inbox, filed };
}

// Re-file a capture the tech already made onto a job or customer (Danny's
// "send it to a page/tile"). Creator-or-leadership only. A job number resolves
// through the same orphan-safe resolver as finalize.
export async function refileCapture(
  id: string,
  input: { targetKind: "job" | "customer"; targetRef: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "not signed in" };
  const sess = await getSessionUser().catch(() => null);
  const supa = db();
  const { data: rec } = await supa.from("recordings").select("id, created_by_uid, finalized_at").eq("id", id).maybeSingle();
  if (!rec) return { ok: false, error: "recording not found" };
  const mine = !!sess?.id && rec.created_by_uid === sess.id;
  if (!mine && !me.isAdmin && !me.isManager) return { ok: false, error: "not your recording" };

  let targetRef = String(input.targetRef ?? "").trim();
  if (!targetRef) return { ok: false, error: "Enter a job number." };
  if (input.targetKind === "job" && !targetRef.startsWith("job_")) {
    const res = await resolveJobRefInternal(targetRef);
    if (!res.ok) return { ok: false, error: res.error };
    targetRef = res.hcp_job_id;
  }
  // Filing is a finalize: pin the audio (job/customer are permanent work product,
  // same as finalizeRecording's keep_audio) and stamp finalized_at if it wasn't
  // already — otherwise a refiled capture sits target_kind-set but finalized_at-null
  // and rides the 30-day sweep while the retention model thinks it's permanent.
  const patch: Record<string, unknown> = { target_kind: input.targetKind, target_ref: targetRef, keep_audio: true };
  if (!rec.finalized_at) patch.finalized_at = new Date().toISOString();
  const { error } = await supa.from("recordings").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/me");
  revalidatePath("/studio");
  return { ok: true };
}

// ── 6. Discard an unfiled capture (deletes object + row) ─────────────────────
export async function discardRecording(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const sess = await getSessionUser().catch(() => null);
  const supa = db();
  const { data: rec } = await supa.from("recordings").select("audio_path, created_by_uid, finalized_at").eq("id", id).maybeSingle();
  if (!rec) return { ok: true }; // already gone
  const mine = !!sess?.id && rec.created_by_uid === sess.id;
  if (!mine && !me.isAdmin && !me.isManager) return { ok: false, error: "not your recording" };
  if (rec.finalized_at) return { ok: false, error: "already saved — manage it from Studio" };
  if (rec.audio_path) {
    try { await supa.storage.from(BUCKET).remove([rec.audio_path as string]); } catch { /* best-effort */ }
  }
  // Authorized above on created_by_uid — delete by id only. Keying the DELETE on
  // the display-name created_by (as before) would no-op on a name mismatch (renamed
  // tech / leadership discarding another's) AFTER the audio was already removed,
  // leaving a dangling row with unplayable audio.
  await supa.from("recordings").delete().eq("id", id).is("finalized_at", null);
  return { ok: true };
}

// ── 7. Edit a capture (Studio Seg 5) — rename + transcript-correct ───────────
// Creator (created_by_uid) or leadership only. Audio trim is a later phase.

// Correct/replace the transcript text. Sets transcript_status='edited' so the
// on-prem worker (which processes transcript_status='pending_local') won't clobber
// a manual correction with a late auto-transcription.
export async function updateRecordingTranscript(id: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const sess = await getSessionUser().catch(() => null);
  const supa = db();
  const { data: rec } = await supa.from("recordings").select("created_by_uid").eq("id", id).maybeSingle();
  if (!rec) return { ok: false, error: "recording not found" };
  const mine = !!sess?.id && rec.created_by_uid === sess.id;
  if (!mine && !me.isAdmin && !me.isManager) return { ok: false, error: "not your recording" };
  const clean = String(text ?? "").trim().slice(0, 8000);
  // A non-empty correction → 'edited' (takes it out of the worker's pending_local
  // queue so a late auto-transcription won't clobber it). CLEARING it → 'blank' (a
  // terminal status, not 'edited'+null) so it doesn't get stuck showing "Transcribing…"
  // forever AND stays out of the queue. Never leave (null, 'edited').
  const { error } = await supa.from("recordings")
    .update({ transcript: clean || null, transcript_status: clean ? "edited" : "blank" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/me");
  revalidatePath("/studio");
  return { ok: true };
}

// Rename/relabel a capture.
export async function renameRecording(id: string, label: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const sess = await getSessionUser().catch(() => null);
  const supa = db();
  const { data: rec } = await supa.from("recordings").select("created_by_uid").eq("id", id).maybeSingle();
  if (!rec) return { ok: false, error: "recording not found" };
  const mine = !!sess?.id && rec.created_by_uid === sess.id;
  if (!mine && !me.isAdmin && !me.isManager) return { ok: false, error: "not your recording" };
  const clean = String(label ?? "").trim().slice(0, 200);
  const { error } = await supa.from("recordings").update({ label: clean || null }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/me");
  revalidatePath("/studio");
  return { ok: true };
}

// Short-lived signed URL for playing a recording. Signed-in users only; the
// audio is otherwise inaccessible (private bucket).
export async function getRecordingSignedUrl(recordingId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  const sess = await getSessionUser().catch(() => null);
  const supa = db();
  const { data: rec } = await supa.from("recordings").select("audio_path, created_by_uid, target_kind").eq("id", recordingId).maybeSingle();
  if (!rec?.audio_path) return { ok: false, error: "recording not found" };
  const audioPath = rec.audio_path as string;
  // Authorize before signing: creator or leadership always; job/customer/estimate
  // recordings are company work product (playable by any signed-in staffer who can
  // reach them); private captures (note_to_danny / claude / file / unfiled) are
  // creator-or-leadership only — closes the IDOR on a directly-POSTed action.
  // Ownership is checked on the STABLE created_by_uid, NOT the display-name
  // created_by (collision-prone — a 2nd "Chris" could otherwise reach the first's
  // private audio). A NULL-uid legacy row is creator-inaccessible (fail-closed) —
  // only leadership / work-product can reach it.
  const mine = !!sess?.id && rec.created_by_uid === sess.id;
  const leadership = me.isAdmin || me.isManager;
  const workProduct = ["job", "customer", "estimate"].includes(String(rec.target_kind ?? ""));
  if (!mine && !leadership && !workProduct) return { ok: false, error: "not authorized" };
  const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(audioPath, 3600);
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? "could not sign url" };
  return { ok: true, url: data.signedUrl };
}
