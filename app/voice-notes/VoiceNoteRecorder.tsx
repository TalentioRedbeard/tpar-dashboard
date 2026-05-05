"use client";

// Browser-side voice recorder + uploader. MediaRecorder API for in-browser
// record; file input for "I already have an audio file." Submits to the
// uploadVoiceNote server action.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadVoiceNote } from "./actions";

type Props = {
  hcpJobId?: string;
  hcpCustomerId?: string;
  defaultIntentTag?: string;
};

export function VoiceNoteRecorder({ hcpJobId, hcpCustomerId, defaultIntentTag }: Props) {
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intentTag, setIntentTag] = useState<string>(defaultIntentTag ?? "estimate-context");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const startTsRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, [recorder]);

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
        setRecordedBlob(blob);
        setRecording(false);
        if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
        stream.getTracks().forEach((t) => t.stop());
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

    startTransition(async () => {
      const res = await uploadVoiceNote(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/voice-notes/${res.voice_note_id}`);
    });
  }

  return (
    <div className="space-y-4">
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

      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Intent tag</label>
        <select
          value={intentTag}
          onChange={(e) => setIntentTag(e.target.value)}
          className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          <option value="estimate-context">Estimate context (use as "Based on…" reference)</option>
          <option value="job-note">Job note (general info, decisions)</option>
          <option value="process-doc">Process documentation</option>
          <option value="other">Other</option>
        </select>
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
