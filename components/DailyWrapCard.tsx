"use client";

// Daily Wrap card on /me — each tech records a ~30-second end-of-day VERBAL wrap
// (power-center-point slice 4, the "funnel of requirement"). Upload-first, same
// durability path as GlobalRecorder: signed-URL upload straight to the private
// 'recordings' bucket (no Vercel body cap), then markRecordingStored →
// markRecordingPendingLocal (on-prem transcription) → finalizeRecording with
// target_kind='daily-wrap'. The hourly tech-wrap-distill sweep turns transcribed
// wraps into the recap + requirements Danny reviews on /conversation.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createRecordingUpload,
  markRecordingStored,
  markRecordingPendingLocal,
  finalizeRecording,
} from "../lib/recordings";
import { browserClient } from "../lib/supabase-browser";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chiTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

export function DailyWrapCard({ tech, wrappedAt }: {
  /** Tech short name — used in the recording label. */
  tech: string;
  /** ISO created_at of today's latest daily-wrap recording, or null if none yet. */
  wrappedAt: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "recording" | "saving">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedAtIso, setSavedAtIso] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const startTsRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  // Kept for "Retry save" if persisting fails — the take isn't lost.
  const blobRef = useRef<Blob | null>(null);
  const durRef = useRef(0);

  useEffect(() => () => { if (tickRef.current) window.clearInterval(tickRef.current); }, []);

  // Direct browser → Storage upload with bounded retry/backoff (mirrors GlobalRecorder).
  async function uploadBlob(path: string, token: string, b: Blob, attempt: number): Promise<boolean> {
    try {
      const supa = browserClient();
      const { error: upErr } = await supa.storage.from("recordings").uploadToSignedUrl(path, token, b, {
        contentType: b.type || "audio/webm",
      });
      if (upErr) throw upErr;
      return true;
    } catch (e) {
      if (attempt < 3) { await sleep(500 * 2 ** attempt); return uploadBlob(path, token, b, attempt + 1); }
      setError(`audio upload failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async function persist(b: Blob, dMs: number) {
    setPhase("saving");
    setError(null);
    const slot = await createRecordingUpload({ mime: b.type || "audio/webm", durationMs: dMs });
    if (!slot.ok) { setError(slot.error); setPhase("idle"); return; }
    const uploaded = await uploadBlob(slot.path, slot.token, b, 0);
    if (!uploaded) { setPhase("idle"); return; }
    const stored = await markRecordingStored(slot.id);
    if (!stored.ok) { setError(stored.error); setPhase("idle"); return; }
    // Route to the on-prem transcription lane — the VM worker fills the transcript,
    // then tech-wrap-distill picks it up. Never gates the save.
    await markRecordingPendingLocal(slot.id);
    const dateChi = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const fin = await finalizeRecording({
      id: slot.id,
      label: `Daily wrap — ${tech} — ${dateChi}`,
      targetKind: "daily-wrap",
    });
    if (!fin.ok) { setError(fin.error); setPhase("idle"); return; }
    blobRef.current = null;
    setSavedAtIso(new Date().toISOString());
    setPhase("idle");
    router.refresh();
  }

  async function startRec() {
    setError(null);
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
        stream.getTracks().forEach((t) => t.stop());
        if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
        blobRef.current = b;
        durRef.current = dMs;
        void persist(b, dMs);
      };
      r.start();
      recorderRef.current = r;
      startTsRef.current = Date.now();
      setElapsed(0);
      setPhase("recording");
      tickRef.current = window.setInterval(() => setElapsed(Date.now() - startTsRef.current), 250);
    } catch (e) {
      setError(`mic access denied: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function stopRec() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  const capturedAt = savedAtIso ?? wrappedAt;

  return (
    <section className="mb-8">
      {/* Framed + labeled like the quick-action tiles (Field Doctrine rollout:
          "each tile clearly framed and labeled") — persistent header, gold
          accent kept as the wrap's identity mark. */}
      <div className="rounded-2xl border-2 border-brand-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2 border-b border-neutral-100 pb-2">
          <span className="text-3xl leading-none" aria-hidden>🌇</span>
          <span className="text-sm font-bold text-brand-900">Daily wrap</span>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-gold-600">30 seconds</span>
        </div>
        {phase === "recording" ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-900">🎙️ Recording your wrap…</div>
              <p className="mt-0.5 text-xs text-neutral-600">Talk it out — tap stop when you&apos;re done.</p>
            </div>
            <button
              type="button"
              onClick={stopRec}
              className="flex shrink-0 items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
            >
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-sm bg-white" /> Stop · {(elapsed / 1000).toFixed(0)}s
            </button>
          </div>
        ) : phase === "saving" ? (
          <div className="text-sm font-medium text-amber-700">💾 Saving your wrap…</div>
        ) : capturedAt ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-700">Wrap captured ✓</div>
              <p className="mt-0.5 text-xs text-neutral-600">
                Recorded at {chiTime(capturedAt)}. Thanks — it goes straight into making the app better.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void startRec()}
              className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Record another
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-neutral-600">
                How&apos;d the day go, what fought you, what should the app do better?
              </p>
            </div>
            <button
              type="button"
              onClick={() => void startRec()}
              className="shrink-0 rounded-full border border-gold-500/60 bg-gold-500/10 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-500/20"
            >
              🎙️ Record
            </button>
          </div>
        )}
        {error ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-700">
            <span>⚠ {error}</span>
            {blobRef.current ? (
              <button
                type="button"
                onClick={() => { if (blobRef.current) void persist(blobRef.current, durRef.current); }}
                className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
              >
                Retry save
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
