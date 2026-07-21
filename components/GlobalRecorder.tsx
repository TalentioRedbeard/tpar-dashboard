"use client";

// Global quick-capture recorder (Danny 2026-05-31; upload-first rewrite 2026-06-08).
// Fixed top-right "Record" button. On stop it UPLOADS THE AUDIO FIRST — directly
// from the browser to the private 'recordings' bucket via a signed upload URL,
// bypassing Vercel's ~4.5MB server-action body cap that used to silently lose long
// recordings. The audio is durable the instant "Audio saved ✓" shows; filing it
// (transcript + target: Danny / job / customer / estimate / file, or — OWNER ONLY
// — 💬 Claude) is a separate, non-destructive step. Transcription is decoupled and
// never gates the save. Auto-detects job/customer from the URL.

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createRecordingUpload,
  markRecordingStored,
  markRecordingPendingLocal,
  getRecordingTranscript,
  finalizeRecording,
  discardRecording,
  resolveJobRef,
} from "../lib/recordings";
import { browserClient } from "../lib/supabase-browser";

// 'daily-wrap' is set by DailyWrapCard (not offered in this recorder's picker).
type Target = "note_to_danny" | "job" | "customer" | "estimate" | "file" | "claude" | "daily-wrap";
type UploadState = "idle" | "uploading" | "stored" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GlobalRecorder({ isOwner = false, clockedInJobId = null }: { isOwner?: boolean; clockedInJobId?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "recording" | "review">("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [label, setLabel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [target, setTarget] = useState<Target>("note_to_danny");
  const [targetRef, setTargetRef] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [jobChip, setJobChip] = useState<{ ok: boolean; text: string } | null>(null);
  const [recId, setRecId] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const startTsRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const storedPendingRef = useRef<string | null>(null); // id whose bytes are uploaded but not yet marked stored
  const savingRef = useRef(false); // in-flight finalize guard (covers the ~900ms reset window)
  // Set when the recording was started on a /job or /customer page → auto-attach it
  // there once the audio is durable (Danny 2026-07-21). Cleared if the user changes
  // the target (they've taken manual control).
  const autoFileRef = useRef<{ target: Target; ref: string } | null>(null);

  // Confirm a typed job id/invoice number resolves to a real job before saving —
  // a raw invoice number silently orphaned the recording before (the C fix).
  async function verifyJob() {
    const ref = targetRef.trim();
    if (target !== "job" || !ref) { setJobChip(null); return; }
    if (ref.startsWith("job_")) { setJobChip({ ok: true, text: "job id" }); return; }
    const r = await resolveJobRef(ref);
    setJobChip(r.ok ? { ok: true, text: r.label } : { ok: false, text: r.error });
  }

  function detectFromUrl(): { target: Target; ref: string } | null {
    const m = pathname?.match(/^\/(job|customer)\/([^/?#]+)/);
    if (m) return { target: m[1] as Target, ref: decodeURIComponent(m[2]) };
    return null;
  }

  // Persist the audio FIRST: mint a signed upload slot, upload the blob straight
  // to Storage (no Vercel hop / no size cap), then mark it stored + transcribe.
  async function beginUpload(b: Blob, dMs: number) {
    setUploadState("uploading");
    setMsg(null);
    storedPendingRef.current = null;
    const slot = await createRecordingUpload({ mime: b.type || "audio/webm", durationMs: dMs });
    if (!slot.ok) { setUploadState("error"); setMsg(slot.error); return; }
    setRecId(slot.id);
    const ok = await uploadBlob(slot.path, slot.token, b, 0);
    if (!ok) { setUploadState("error"); return; }
    storedPendingRef.current = slot.id; // bytes are durable in the bucket now
    const stored = await markRecordingStored(slot.id);
    if (!stored.ok) { setUploadState("error"); setMsg(stored.error); return; }
    storedPendingRef.current = null;
    setUploadState("stored");
    void transcribeNow(slot.id);
    // Recorded from a job/customer page → attach it there automatically, no Save
    // tap needed (Danny 2026-07-21). The on-prem transcript still lands afterward
    // (the worker no-clobbers). If finalize errors, fall back to the manual Save.
    const auto = autoFileRef.current;
    if (auto && (auto.target === "job" || auto.target === "customer") && !savingRef.current) {
      savingRef.current = true;
      const fin = await finalizeRecording({ id: slot.id, label: "", transcript: "", targetKind: auto.target, targetRef: auto.ref });
      if (fin.ok) {
        setMsg(auto.target === "job" ? "✓ Attached to this job" : "✓ Attached to this customer");
        setTimeout(() => { reset(); router.refresh(); }, 1200);
      } else {
        savingRef.current = false; // let the user save manually
      }
    }
  }

  // Direct browser → Storage upload with bounded retry/backoff.
  async function uploadBlob(path: string, token: string, b: Blob, attempt: number): Promise<boolean> {
    try {
      const supa = browserClient();
      const { error } = await supa.storage.from("recordings").uploadToSignedUrl(path, token, b, {
        contentType: b.type || "audio/webm",
      });
      if (error) throw error;
      return true;
    } catch (e) {
      if (attempt < 3) { await sleep(500 * 2 ** attempt); return uploadBlob(path, token, b, attempt + 1); }
      setMsg(`audio upload failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  // Transcription is on-prem now (P5): mark the recording for the VM worker, which
  // transcribes it locally and writes it back — the audio never leaves the building.
  // Best-effort: poll for the transcript while the user is still in the review card so
  // it can appear inline; if they save first, the worker fills it (no-clobber). Saving
  // never waits on this.
  async function transcribeNow(id: string) {
    setTranscribing(true);
    try {
      const m = await markRecordingPendingLocal(id);
      if (!m.ok) { setTranscribing(false); return; }
      for (let i = 0; i < 12; i++) {
        await sleep(4000);
        const r = await getRecordingTranscript(id);
        if (r.transcript && r.transcript.trim()) { setTranscript((cur) => cur || r.transcript!); break; }
        if (["blank", "music", "failed", "too_large"].includes(r.status ?? "")) break;
      }
    } catch { /* leave transcript empty; user can type */ }
    setTranscribing(false);
  }

  async function retryUpload() {
    // If the bytes already uploaded and only the status-flip failed, just re-confirm —
    // re-uploading would mint a new object and orphan the durable one.
    const pendingId = storedPendingRef.current;
    if (pendingId) {
      setUploadState("uploading"); setMsg(null);
      const stored = await markRecordingStored(pendingId);
      if (!stored.ok) { setUploadState("error"); setMsg(stored.error); return; }
      storedPendingRef.current = null;
      setUploadState("stored");
      void transcribeNow(pendingId);
      return;
    }
    if (blob) void beginUpload(blob, durationMs);
  }

  async function startRec() {
    setMsg(null); setBlob(null); setTranscript(""); setRecId(null); setUploadState("idle");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      r.onstop = () => {
        const b = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        const dMs = Date.now() - startTsRef.current;
        setBlob(b);
        setDurationMs(dMs);
        stream.getTracks().forEach((t) => t.stop());
        if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
        const d = detectFromUrl();
        if (d) { setTarget(d.target); setTargetRef(d.ref); autoFileRef.current = d; }
        else if (!isOwner && clockedInJobId) { setTarget("job"); setTargetRef(clockedInJobId); }
        setState("review");
        void beginUpload(b, dMs); // persist immediately — before the user picks a target
      };
      r.start();
      recorderRef.current = r;
      startTsRef.current = Date.now();
      setElapsed(0);
      setState("recording");
      tickRef.current = window.setInterval(() => setElapsed(Date.now() - startTsRef.current), 250);
    } catch (e) {
      setMsg(`mic access denied: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function stopRec() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  function reset() {
    setState("idle"); setBlob(null); setLabel(""); setTranscript(""); setTargetRef(""); setMsg(null);
    setTarget("note_to_danny"); setJobChip(null); setRecId(null); setUploadState("idle");
    storedPendingRef.current = null; savingRef.current = false; autoFileRef.current = null;
  }

  // Discard an unfiled capture. Only delete once the audio has settled — deleting
  // mid-upload could race the in-flight PUT and orphan the object. While uploading
  // we just reset the UI and leave the row to the object-aware sweep (which recovers
  // it if the bytes land, or deletes the empty row if they don't).
  function discard() {
    const id = recId;
    if (id && (uploadState === "stored" || uploadState === "error")) void discardRecording(id);
    reset();
  }

  function save() {
    if (!recId || uploadState !== "stored") return; // audio must be durable first
    if (savingRef.current) return; // guard the ~900ms reset window against a double-tap
    savingRef.current = true;
    setMsg(null);
    start(async () => {
      try {
        const r = await finalizeRecording({ id: recId, label, transcript, targetKind: target, targetRef });
        if (r.ok) { setMsg(target === "claude" ? "Sent to Claude ✓" : "Saved ✓"); setTimeout(() => { reset(); router.refresh(); }, 900); }
        else { setMsg(r.error); savingRef.current = false; } // re-enable so the user can retry
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e)); savingRef.current = false;
      }
    });
  }

  const needsRef = target === "job" || target === "customer" || target === "estimate";
  const saveDisabled = pending || uploadState !== "stored";

  return (
    <div className="fixed right-4 top-16 z-[60] print:hidden">
      {state === "idle" ? (
        <button
          type="button"
          onClick={startRec}
          title="Record a quick note"
          className="flex items-center gap-1.5 rounded-full border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 shadow-md hover:bg-red-50"
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" /> Record
        </button>
      ) : state === "recording" ? (
        <button
          type="button"
          onClick={stopRec}
          className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-md hover:bg-red-700"
        >
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-sm bg-white" /> Stop · {(elapsed / 1000).toFixed(0)}s
        </button>
      ) : (
        <div className="w-80 rounded-2xl border border-neutral-300 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-900">🎤 Save recording</span>
            <span className="text-xs text-neutral-400">{(durationMs / 1000).toFixed(1)}s</span>
          </div>

          {/* Durability indicator — the audio is safe the moment this says saved. */}
          <div className="mb-2 text-xs font-medium">
            {uploadState === "uploading" ? (
              <span className="text-amber-700">💾 Saving audio…</span>
            ) : uploadState === "stored" ? (
              <span className="text-emerald-700">✓ Audio saved</span>
            ) : uploadState === "error" ? (
              <span className="flex items-center gap-2 text-red-700">
                ⚠ Audio not saved
                <button type="button" onClick={() => void retryUpload()} className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50">Retry</button>
              </span>
            ) : null}
          </div>

          {blob ? <audio controls src={URL.createObjectURL(blob)} className="mb-2 w-full" /> : null}
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={transcribing ? "Transcribing on-prem… (or type one — saving won't wait)" : "Transcript (editable)"}
            rows={3}
            className="mb-2 w-full resize-y rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label / title (optional)" className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <select value={target} onChange={(e) => { setTarget(e.target.value as Target); autoFileRef.current = null; }} className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm">
            {isOwner ? <option value="claude">💬 Send to Claude (dev)</option> : null}
            <option value="note_to_danny">📨 Send to Danny</option>
            <option value="job">🧰 Attach to job</option>
            <option value="customer">👤 Attach to customer</option>
            <option value="estimate">📝 Attach to estimate</option>
            <option value="file">📁 Just save as file</option>
          </select>
          {needsRef ? (
            <div className="mb-2">
              <input value={targetRef}
                onChange={(e) => { setTargetRef(e.target.value); setJobChip(null); }}
                onBlur={() => { if (target === "job") void verifyJob(); }}
                placeholder={target === "job" ? "job id (job_…) or invoice #" : `${target} id / number`}
                className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm" />
              {jobChip ? (
                <div className={`mt-1 text-[11px] ${jobChip.ok ? "text-emerald-700" : "text-red-700"}`}>
                  {jobChip.ok ? "✓ " : "⚠ "}{jobChip.text}
                </div>
              ) : null}
            </div>
          ) : null}
          {target === "claude" ? (
            <div className="mb-2 text-[11px] text-neutral-500">Goes to the Claude dev queue — picked up in an active session.</div>
          ) : null}
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saveDisabled} className="flex-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
              {pending ? "Saving…" : uploadState === "uploading" ? "Saving audio…" : uploadState === "error" ? "Audio not saved" : target === "claude" ? "Send to Claude" : "Save"}
            </button>
            <button type="button" onClick={discard} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Discard</button>
          </div>
          {msg ? <div className="mt-1 text-xs text-neutral-600">{msg}</div> : null}
        </div>
      )}
    </div>
  );
}
