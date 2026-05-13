"use client";

// Browser-side voice recorder + uploader. MediaRecorder API for in-browser
// record; file input for "I already have an audio file." Submits to the
// uploadVoiceNote server action.
//
// Persistence (added 2026-05-13 after Danny lost a recording to a 404):
// each captured blob is written to IndexedDB before the upload attempt.
// Survives page reloads, navigations, upload failures. Cleared on success.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadVoiceNote } from "./actions";
import {
  saveRecording,
  clearRecording,
  listPendingRecordings,
  pruneOldRecordings,
  type PendingRecording,
} from "./blobStore";

type IntentOption = { value: string; label: string };

type Props = {
  hcpJobId?: string;
  hcpCustomerId?: string;
  defaultIntentTag?: string;
  intentOptions?: IntentOption[];
  showNeedsDiscussion?: boolean;
};

const TECH_INTENT_OPTIONS: IntentOption[] = [
  { value: "estimate-context", label: "Estimate context (use as Based-on… reference)" },
  { value: "job-note",         label: "Job note (general info, decisions on site)" },
  { value: "process-doc",      label: "Process documentation" },
  { value: "other",            label: "Other" },
];

const LEADERSHIP_INTENT_OPTIONS: IntentOption[] = [
  { value: "estimate-context",   label: "Estimate context (use as Based-on… reference)" },
  { value: "scheduling-issue",   label: "Scheduling issue / dispatch concern" },
  { value: "process-concern",    label: "Process concern (workflow, system, organization)" },
  { value: "employee-concern",   label: "Employee concern (private — leadership only)" },
  { value: "system-issue",       label: "System / website / tool issue" },
  { value: "leadership-note",    label: "Leadership note (general — discuss later)" },
  { value: "job-note",           label: "Job note (general info, decisions)" },
  { value: "process-doc",        label: "Process documentation" },
  { value: "other",              label: "Other" },
];

export const TECH_INTENTS = TECH_INTENT_OPTIONS;
export const LEADERSHIP_INTENTS = LEADERSHIP_INTENT_OPTIONS;

export function VoiceNoteRecorder({ hcpJobId, hcpCustomerId, defaultIntentTag, intentOptions, showNeedsDiscussion }: Props) {
  const options = intentOptions ?? TECH_INTENT_OPTIONS;
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intentTag, setIntentTag] = useState<string>(defaultIntentTag ?? options[0]?.value ?? "estimate-context");
  const [needsDiscussion, setNeedsDiscussion] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const startTsRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  // Tracks the IndexedDB id of the *currently active* recording so we can
  // delete it after a successful upload (or keep it if upload fails).
  const pendingIdRef = useRef<string | null>(null);

  // Recovery banner: surface any unsent recordings from prior sessions on mount.
  const [recoverable, setRecoverable] = useState<PendingRecording[]>([]);
  const [dismissedRecovery, setDismissedRecovery] = useState(false);

  useEffect(() => {
    // Prune anything older than the safety-net window, then list what's left.
    (async () => {
      try {
        await pruneOldRecordings();
        const pending = await listPendingRecordings();
        setRecoverable(pending);
      } catch {
        // IndexedDB unavailable (private mode, ancient browser) — skip silently.
      }
    })();
  }, []);

  async function adoptRecoverable(p: PendingRecording): Promise<void> {
    setError(null);
    setPickedFile(null);
    setRecordedBlob(p.blob);
    setRecordedDurationMs(p.durationMs);
    pendingIdRef.current = p.id;
    // Remove from the recovery list so the banner clears.
    setRecoverable((prev) => prev.filter((r) => r.id !== p.id));
  }

  async function discardRecoverable(p: PendingRecording): Promise<void> {
    try { await clearRecording(p.id); } catch { /* ignore */ }
    setRecoverable((prev) => prev.filter((r) => r.id !== p.id));
  }

  // Stop the recorder when this component unmounts OR when `recorder`
  // changes to a new instance. Don't touch tickRef here — this cleanup
  // ran on every recorder transition (null → r), which used to clear the
  // interval immediately after startRecording registered it. Bug found in
  // the field 2026-05-13: timer stuck at 0.0s while recording.
  useEffect(() => () => {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, [recorder]);

  // Interval cleanup ONLY on unmount.
  useEffect(() => () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
  }, []);

  async function startRecording() {
    setError(null);
    setRecordedBlob(null);
    setPickedFile(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      r.onstop = () => {
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        const durationMs = Date.now() - startTsRef.current;
        setRecordedBlob(blob);
        setRecording(false);
        if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
        stream.getTracks().forEach((t) => t.stop());

        // Persist to IndexedDB immediately so the blob survives a navigation
        // or upload failure. Cleared after successful upload in submit().
        saveRecording({
          blob,
          metadata: {
            hcpJobId,
            hcpCustomerId,
            intentTag,
            needsDiscussion,
            source: "dashboard",
          },
          recordedAt: Date.now(),
          durationMs,
        }).then((id) => {
          pendingIdRef.current = id;
        }).catch(() => {
          // IndexedDB write failed — proceed without persistence rather than
          // blocking the upload. The user still has the in-memory blob.
        });
      };
      r.start();
      setRecorder(r);
      setRecording(true);
      startTsRef.current = Date.now();
      tickRef.current = window.setInterval(() => {
        setRecordedDurationMs(Date.now() - startTsRef.current);
      }, 250);
    } catch (e) {
      setError(`mic access denied: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function submit() {
    setError(null);
    const blobToSend: File | Blob | null = pickedFile ?? recordedBlob;
    if (!blobToSend) {
      setError("record or pick a file first");
      return;
    }
    const file = blobToSend instanceof File
      ? blobToSend
      : new File([blobToSend], `voice-note-${Date.now()}.webm`, { type: (blobToSend as Blob).type || "audio/webm" });

    const fd = new FormData();
    fd.set("audio", file, file.name);
    if (hcpJobId)      fd.set("hcp_job_id", hcpJobId);
    if (hcpCustomerId) fd.set("hcp_customer_id", hcpCustomerId);
    if (intentTag)     fd.set("intent_tag", intentTag);
    if (needsDiscussion) fd.set("needs_discussion", "1");

    startTransition(async () => {
      const res = await uploadVoiceNote(fd);
      if (!res.ok) {
        // Keep the IndexedDB row — user can retry without losing audio.
        setError(res.error);
        return;
      }
      // Upload succeeded — drop the persisted blob.
      if (pendingIdRef.current) {
        clearRecording(pendingIdRef.current).catch(() => { /* ignore */ });
        pendingIdRef.current = null;
      }
      router.push(`/voice-notes/${res.voice_note_id}`);
    });
  }

  return (
    <div className="space-y-4">
      {recoverable.length > 0 && !dismissedRecovery ? (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-amber-900">
                {recoverable.length} unsent recording{recoverable.length === 1 ? "" : "s"} from earlier
              </div>
              <p className="mt-1 text-xs text-amber-800">
                These were captured but not successfully uploaded (page closed, upload failed, etc.).
                Retry or discard.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedRecovery(true)}
              className="text-xs text-amber-700 hover:text-amber-900"
              title="Hide this banner for the current session (recordings stay saved)"
            >
              Hide
            </button>
          </div>
          <ul className="mt-3 space-y-1.5">
            {recoverable.map((p) => {
              const date = new Date(p.recordedAt);
              const ago = Math.round((Date.now() - p.recordedAt) / 60000);
              const dur = (p.durationMs / 1000).toFixed(1);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-2 text-xs">
                  <span className="font-medium text-neutral-900">{dur}s</span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-600">
                    {ago < 60 ? `${ago} min ago` : date.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                  {p.metadata.hcpJobId ? <span className="text-neutral-500">· job <code className="rounded bg-neutral-100 px-1">{p.metadata.hcpJobId.slice(-8)}</code></span> : null}
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => void adoptRecoverable(p)}
                      className="rounded-md bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      Load to retry
                    </button>
                    <button
                      type="button"
                      onClick={() => void discardRecoverable(p)}
                      className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50"
                    >
                      Discard
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Record</div>
        <div className="flex flex-wrap items-center gap-3">
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={isPending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              ● Start recording
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900"
            >
              ■ Stop
            </button>
          )}
          {recording ? (
            <span className="text-sm tabular-nums text-red-700">
              ● Recording {(recordedDurationMs / 1000).toFixed(1)}s
            </span>
          ) : recordedBlob ? (
            <span className="text-xs text-neutral-600">Recorded — {(recordedBlob.size / 1024).toFixed(0)} KB</span>
          ) : null}
        </div>
        {recordedBlob ? (
          <audio
            controls
            className="mt-3 w-full"
            src={URL.createObjectURL(recordedBlob)}
          />
        ) : null}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Or upload an existing file</div>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setPickedFile(f);
            if (f) setRecordedBlob(null);
          }}
          className="block w-full text-sm"
        />
        {pickedFile ? (
          <div className="mt-2 text-xs text-neutral-600">{pickedFile.name} — {(pickedFile.size / 1024).toFixed(0)} KB</div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Intent tag</label>
          <select
            value={intentTag}
            onChange={(e) => setIntentTag(e.target.value)}
            className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {showNeedsDiscussion ? (
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={needsDiscussion}
              onChange={(e) => setNeedsDiscussion(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Flag for discussion</span>
              <span className="block text-xs text-neutral-500">Surfaces in the leadership concerns queue until resolved.</span>
            </span>
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={isPending || (!recordedBlob && !pickedFile)}
        className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {isPending ? "Uploading + transcribing…" : "Upload & transcribe"}
      </button>
      <p className="text-xs text-neutral-500">
        Audio goes to private Supabase storage. Whisper transcription typically takes 5-15 seconds.
      </p>
    </div>
  );
}
