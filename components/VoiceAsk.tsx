"use client";
// VoiceAsk — push-to-talk voice lane for /ask (Hey-TPAR rung 1, 2026-07-10).
// Tap -> record -> on-prem whisper -> ask-tpar (caller-scoped JWT) -> spoken
// answer. Two-speed pattern (Danny's design): if the answer isn't back in
// ~3.5s, play the cached "let me look that up" ack so the conversation never
// sits in dead air. Voice is additive — every failure degrades to text.
import { useRef, useState } from "react";

type Phase = "idle" | "recording" | "transcribing" | "asking" | "done" | "error";

const MAX_RECORD_MS = 30_000;
const ACK_DELAY_MS = 3_500;
// Tiny silent wav to unlock audio playback inside the tap gesture (iOS).
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export function VoiceAsk() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function player(): HTMLAudioElement {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }

  async function start() {
    setError(null);
    setTranscript(null);
    setAnswer(null);
    // Unlock playback while we're still inside the user gesture.
    const a = player();
    a.muted = true;
    a.src = SILENT_WAV;
    a.play().catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void send(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      recRef.current = rec;
      rec.start();
      setPhase("recording");
      stopTimerRef.current = setTimeout(() => stop(), MAX_RECORD_MS);
    } catch {
      setError("Mic unavailable — check browser permissions, or just type below.");
      setPhase("error");
    }
  }

  function stop() {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function send(blob: Blob) {
    setPhase("transcribing");
    try {
      const fd = new FormData();
      fd.append("audio", blob, `voice-ask.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
      const tr = await fetch("/api/voice-ask/transcribe", { method: "POST", body: fd });
      const tj = (await tr.json().catch(() => null)) as {
        ok?: boolean;
        transcript?: string;
        ackUrl?: string | null;
        error?: string;
      } | null;
      if (!tr.ok || !tj?.ok) throw new Error(tj?.error ?? `transcribe failed (${tr.status})`);
      const q = (tj.transcript ?? "").trim();
      if (!q) {
        setError("Didn't catch that — try again a little closer to the mic.");
        setPhase("error");
        return;
      }
      setTranscript(q);
      setPhase("asking");

      // Two-speed bridge: fast answers come straight back; anything slower
      // gets the spoken "let me look that up" so there's never dead air.
      let answered = false;
      const ackTimer = setTimeout(() => {
        if (!answered && tj.ackUrl) {
          const a = player();
          a.muted = false;
          a.src = tj.ackUrl;
          a.play().catch(() => {});
        }
      }, ACK_DELAY_MS);

      const ar = await fetch("/api/voice-ask/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      answered = true;
      clearTimeout(ackTimer);
      const aj = (await ar.json().catch(() => null)) as {
        ok?: boolean;
        answer?: string;
        audioUrl?: string | null;
        error?: string;
      } | null;
      if (!ar.ok || !aj?.ok || !aj.answer) throw new Error(aj?.error ?? `ask failed (${ar.status})`);
      setAnswer(aj.answer);
      setPhase("done");
      if (aj.audioUrl) {
        const a = player();
        a.muted = false;
        const playAnswer = () => {
          a.onended = null;
          a.src = aj.audioUrl as string;
          a.play().catch(() => {});
        };
        // If the ack is mid-sentence, let it finish, then answer.
        if (!a.paused && a.src && a.src !== SILENT_WAV) a.onended = playAnswer;
        else playAnswer();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  const busy = phase === "transcribing" || phase === "asking";

  return (
    <section className="mb-6">
      <div className="rounded-2xl border-2 border-brand-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={phase === "recording" ? stop : start}
            disabled={busy}
            className={`shrink-0 rounded-xl border-2 px-4 py-3 text-sm font-bold transition ${
              phase === "recording"
                ? "border-red-300 bg-red-50 text-red-700"
                : busy
                ? "border-neutral-200 bg-neutral-50 text-neutral-400"
                : "border-brand-300 bg-brand-50 text-brand-900 hover:border-brand-400 hover:bg-brand-100"
            }`}
          >
            {phase === "recording" ? "⏹ Stop" : "🎤 Ask by voice"}
          </button>
          <div className="min-w-0 flex-1 text-sm text-neutral-600">
            {phase === "idle" && <>Tap, ask out loud, tap again. Same answers as typing — spoken back to you.</>}
            {phase === "recording" && (
              <span className="font-semibold text-red-600">Listening… tap stop when you&apos;re done.</span>
            )}
            {phase === "transcribing" && <>Got it — writing that down…</>}
            {phase === "asking" && (
              <>
                Heard: <span className="font-medium text-neutral-900">&ldquo;{transcript}&rdquo;</span> — looking it
                up…
              </>
            )}
            {phase === "done" && transcript && (
              <>
                <span className="font-medium text-neutral-900">&ldquo;{transcript}&rdquo;</span>
              </>
            )}
            {phase === "error" && <span className="text-amber-700">{error}</span>}
          </div>
        </div>
        {answer ? (
          <div className="mt-3 whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800">
            {answer}
          </div>
        ) : null}
      </div>
    </section>
  );
}
