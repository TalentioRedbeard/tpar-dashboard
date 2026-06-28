"use client";

// Always-listening "office notes" recorder (Danny 2026-06-12). When ON it records
// the mic in rolling 5-minute chunks; each chunk is transcribed server-side into
// office_notes ("if blank -> NULL"; music nulled too). The single off-switch is this
// toggle; closing the laptop suspends the tab and stops it. Owner-only. Sticky: once
// on, it auto-resumes on reload (= "always on while the dashboard is open").

import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "../lib/supabase-browser";
import { createOfficeNoteUpload, markOfficeNotePendingLocal, saveSilentOfficeNote, retranscribePendingOfficeNotes, startConversation, stopConversation } from "../lib/office-notes";

const CHUNK_MS = 5 * 60 * 1000;  // 5-minute segments (Danny's spec)
const SILENCE_RMS = 0.012;       // peak below this across the chunk = silent (tune on test)
const LS_KEY = "office_capture_on";

export function AmbientRecorder({ isOwner = false }: { isOwner?: boolean }) {
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<string>("");

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const peakRef = useRef(0);
  const meterWorkingRef = useRef(false);     // did the level meter ever produce a reading?
  const chunkStartRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const onRef = useRef(false);               // latest 'on' for async closures
  const convIdRef = useRef<string | null>(null);  // P2: active conversation id (null = ambient mode)
  const seqRef = useRef(0);                  // chunk order within the active conversation
  const [inConversation, setInConversation] = useState(false);

  const processChunk = useCallback(
    async (blob: Blob, startedAt: string, endedAt: string, durationMs: number, peak: number) => {
      try {
        if (durationMs < 1500) return; // ignore sub-2s scraps
        const convId = convIdRef.current;
        // Ambient mode skips silent chunks; conversation mode keeps EVERYTHING (natural pauses).
        if (!convId && meterWorkingRef.current && peak < SILENCE_RMS) {
          await saveSilentOfficeNote({ startedAt, endedAt, durationMs });
          return;
        }
        const slot = await createOfficeNoteUpload({
          mime: blob.type || "audio/webm", startedAt, endedAt, durationMs,
          ...(convId ? { conversationId: convId, seq: seqRef.current++ } : {}),
        });
        if (!slot.ok) { setStatus(`save error: ${slot.error}`); return; }
        const supa = browserClient();
        const { error } = await supa.storage.from("recordings").uploadToSignedUrl(slot.path, slot.token, blob, {
          contentType: blob.type || "audio/webm",
        });
        if (error) { setStatus("audio upload failed"); return; }
        // ambient chunks -> per-chunk local lane; conversation chunks are stitched + diarized as one
        // by the finalize worker on Stop, so don't transcribe them individually.
        if (!convId) void markOfficeNotePendingLocal(slot.id);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const startChunk = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !onRef.current) return;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const parts: BlobPart[] = [];
    peakRef.current = 0;
    chunkStartRef.current = Date.now();
    r.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
    r.onstop = () => {
      const startedAt = new Date(chunkStartRef.current).toISOString();
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - chunkStartRef.current;
      const blob = new Blob(parts, { type: r.mimeType || "audio/webm" });
      void processChunk(blob, startedAt, endedAt, durationMs, peakRef.current);
      if (onRef.current && streamRef.current) startChunk(); // roll to the next chunk
    };
    r.start();
    recRef.current = r;
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => { if (r.state !== "inactive") r.stop(); }, CHUNK_MS);
  }, [processChunk]);

  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new AC();
      void ac.resume().catch(() => {});
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      acRef.current = ac;
      const buf = new Uint8Array(an.fftSize);
      levelTimerRef.current = window.setInterval(() => {
        if (ac.state !== "running") return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        meterWorkingRef.current = true;
        if (rms > peakRef.current) peakRef.current = rms;
      }, 400);
    } catch { /* best-effort; without it, everything transcribes (safe) */ }
  }, []);

  const turnOn = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      onRef.current = true;
      meterWorkingRef.current = false;
      setOn(true);
      setStatus("");
      try { localStorage.setItem(LS_KEY, "1"); } catch { /* ignore */ }
      startLevelMeter(stream);
      startChunk();
    } catch (e) {
      setStatus(`mic blocked: ${e instanceof Error ? e.message : String(e)}`);
      onRef.current = false;
      setOn(false);
    }
  }, [startChunk, startLevelMeter]);

  const turnOff = useCallback(() => {
    onRef.current = false;
    setOn(false);
    try { localStorage.setItem(LS_KEY, "0"); } catch { /* ignore */ }
    if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); // onstop finalizes the partial
    if (acRef.current) { try { void acRef.current.close(); } catch { /* ignore */ } acRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  // P2 conversation mode: a deliberate Start/Stop session (vs always-on ambient). Start creates a
  // conversation + records chunks tagged to it (silence gate off, all audio kept); Stop flips it to
  // 'finalizing' so the VM worker stitches + diarizes the whole thing into a speaker-labeled record.
  const startConv = useCallback(async () => {
    const r = await startConversation();
    if (!r.ok) { setStatus(`conversation: ${r.error}`); return; }
    convIdRef.current = r.id;
    seqRef.current = 0;
    setInConversation(true);
    await turnOn();
  }, [turnOn]);

  const stopConv = useCallback(async () => {
    turnOff();
    const id = convIdRef.current;
    convIdRef.current = null;
    setInConversation(false);
    if (id) {
      try { await stopConversation(id); } catch { /* best-effort */ }
      setStatus("conversation saved — transcribing + diarizing on-prem…");
    }
  }, [turnOff]);

  // Sticky auto-resume: if it was left on, restart on load (always-on while the tab is open).
  useEffect(() => {
    if (!isOwner) return;
    let was = "0";
    try { was = localStorage.getItem(LS_KEY) ?? "0"; } catch { /* ignore */ }
    if (was === "1") void turnOn();
    return () => {
      onRef.current = false;
      if (recRef.current && recRef.current.state !== "inactive") { try { recRef.current.stop(); } catch { /* ignore */ } }
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [isOwner]);

  // Self-heal any stragglers (audio uploaded but transcribe never finished).
  useEffect(() => {
    if (!isOwner) return;
    void retranscribePendingOfficeNotes();
  }, [isOwner]);

  if (!isOwner) return null;

  return (
    <div className="fixed right-4 top-28 z-[55] flex flex-col items-end gap-1.5 print:hidden">
      {inConversation ? (
        <button
          type="button"
          onClick={stopConv}
          title="Stop + save this conversation (transcribed + speaker-separated on-prem)"
          className="flex items-center gap-1.5 rounded-full border border-red-500 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" /> Stop conversation
        </button>
      ) : (
        <>
          {on ? (
            <button
              type="button"
              onClick={turnOff}
              title="Office capture is ON — click to stop (or just close your laptop)"
              className="flex items-center gap-1.5 rounded-full border border-red-400 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 shadow"
            >
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" /> Recording office
            </button>
          ) : (
            <button
              type="button"
              onClick={turnOn}
              title="Start always-on office capture (5-min transcripts → office_notes)"
              className="flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500 shadow hover:bg-neutral-50"
            >
              <span className="inline-block h-2 w-2 rounded-full border border-neutral-400" /> Office capture off
            </button>
          )}
          <button
            type="button"
            onClick={startConv}
            title="Record a conversation — transcribed + speaker-separated on-prem"
            className="flex items-center gap-1.5 rounded-full border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 shadow hover:bg-blue-50"
          >
            🎙️ Start conversation
          </button>
        </>
      )}
      {status ? <div className="mt-1 max-w-[210px] text-right text-[10px] text-neutral-600">{status}</div> : null}
    </div>
  );
}
