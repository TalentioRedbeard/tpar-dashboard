"use client";

// Global quick-capture recorder (Danny 2026-05-31). Fixed top-right button that
// immediately starts recording on click. On stop it auto-transcribes (Whisper)
// and shows an editable transcript, then: label + target (Danny / job / customer
// / estimate / file, and — OWNER ONLY — 💬 send to Claude for the dev loop).
// Auto-detects job/customer from the URL.

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { saveRecording, transcribeRecording, resolveJobRef } from "../lib/recordings";

type Target = "note_to_danny" | "job" | "customer" | "estimate" | "file" | "claude";

export function GlobalRecorder({ isOwner = false }: { isOwner?: boolean }) {
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

  // Confirm a typed job id/invoice number resolves to a real job before saving —
  // a raw invoice number silently orphaned the recording before (the C fix).
  async function verifyJob() {
    const ref = targetRef.trim();
    if (target !== "job" || !ref) { setJobChip(null); return; }
    if (ref.startsWith("job_")) { setJobChip({ ok: true, text: "job id" }); return; }
    const r = await resolveJobRef(ref);
    setJobChip(r.ok ? { ok: true, text: r.label } : { ok: false, text: r.error });
  }

  const recorderRef = useRef<MediaRecorder | null>(null);
  const startTsRef = useRef(0);
  const tickRef = useRef<number | null>(null);

  function detectFromUrl(): { target: Target; ref: string } | null {
    const m = pathname?.match(/^\/(job|customer)\/([^/?#]+)/);
    if (m) return { target: m[1] as Target, ref: decodeURIComponent(m[2]) };
    return null;
  }

  async function transcribe(b: Blob) {
    setTranscribing(true);
    try {
      const file = new File([b], `rec-${Date.now()}.webm`, { type: b.type || "audio/webm" });
      const fd = new FormData();
      fd.set("audio", file, file.name);
      const r = await transcribeRecording(fd);
      // Don't clobber anything the user already typed while we were transcribing.
      if (r.ok && r.transcript) setTranscript((cur) => cur || r.transcript);
    } catch { /* leave transcript empty; user can type */ }
    setTranscribing(false);
  }

  async function startRec() {
    setMsg(null); setBlob(null); setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      r.onstop = () => {
        const b = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        setBlob(b);
        setDurationMs(Date.now() - startTsRef.current);
        stream.getTracks().forEach((t) => t.stop());
        if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
        const d = detectFromUrl();
        if (d) { setTarget(d.target); setTargetRef(d.ref); }
        setState("review");
        void transcribe(b);
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
    setState("idle"); setBlob(null); setLabel(""); setTranscript(""); setTargetRef(""); setMsg(null); setTarget("note_to_danny"); setJobChip(null);
  }

  function save() {
    if (!blob) return;
    const file = new File([blob], `rec-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
    const fd = new FormData();
    fd.set("audio", file, file.name);
    fd.set("label", label);
    fd.set("transcript", transcript);
    fd.set("target_kind", target);
    fd.set("target_ref", targetRef);
    fd.set("duration_ms", String(durationMs));
    setMsg(null);
    start(async () => {
      const r = await saveRecording(fd);
      if (r.ok) { setMsg(target === "claude" ? "Sent to Claude ✓" : "Saved ✓"); setTimeout(() => { reset(); router.refresh(); }, 900); }
      else setMsg(r.error);
    });
  }

  const needsRef = target === "job" || target === "customer" || target === "estimate";

  return (
    <div className="fixed right-4 top-4 z-[60] print:hidden">
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
          {blob ? <audio controls src={URL.createObjectURL(blob)} className="mb-2 w-full" /> : null}
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={transcribing ? "Transcribing…" : "Transcript (editable)"}
            rows={3}
            className="mb-2 w-full resize-y rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label / title (optional)" className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <select value={target} onChange={(e) => setTarget(e.target.value as Target)} className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm">
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
            <button type="button" onClick={save} disabled={pending || (transcribing && (target === "claude" || target === "note_to_danny"))} className="flex-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "Saving…" : (transcribing && (target === "claude" || target === "note_to_danny")) ? "Transcribing…" : target === "claude" ? "Send to Claude" : "Save"}</button>
            <button type="button" onClick={reset} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Discard</button>
          </div>
          {msg ? <div className="mt-1 text-xs text-neutral-600">{msg}</div> : null}
        </div>
      )}
    </div>
  );
}
