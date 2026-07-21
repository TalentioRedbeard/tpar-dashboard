"use client";

// Always-listening "office notes" recorder (Danny 2026-06-12). When ON it records
// the mic in rolling 5-minute chunks; each chunk is transcribed server-side into
// office_notes. The single off-switch is this toggle; closing the laptop suspends
// the tab and stops it. Owner-only. Sticky: once on, it auto-resumes on reload.
//
// CAPTURE-HEALTH SAFEGUARD (Danny 2026-06-29): a dead/misconfigured mic used to be
// invisible — a plugged-in USB/XLR mic with the gain dial down or a mute switch on
// would record 5 min of silence and you'd never know. Now the UI shows a LIVE input
// meter, the ACTIVE device name, a device PICKER, and a loud "no input" warning when
// the signal flatlines while recording. So you can watch the dial take effect.

import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "../lib/supabase-browser";
import { createOfficeNoteUpload, markOfficeNotePendingLocal, saveSilentOfficeNote, retranscribePendingOfficeNotes, startConversation, stopConversation } from "../lib/office-notes";

const CHUNK_MS = 60 * 1000;  // 1-minute segments (Danny 2026-06-29: 5 min lagged too much while
// developing out loud — wanted near-real-time feedback). Compute is NOT the constraint: the warm
// VM model transcribes 60s of audio in ~3-5s (~8% GPU1 duty), and total transcribe work scales with
// audio length, not chunk count — only small per-chunk overhead. The real tradeoff is transcript
// coherence across boundaries (a sentence split between chunks); 60s is the sweet spot. Drop toward
// 30s for snappier feedback at the cost of more split sentences.
const SILENCE_RMS = 0.012;       // peak below this across the chunk = silent (tune on test)
const NO_SIGNAL_RMS = 0.005;     // live level below this = effectively no input
const NO_SIGNAL_MS = 4000;       // ...sustained this long while ON -> warn (dial down / muted)
const LS_KEY = "office_capture_on";
const LS_DEV = "office_capture_device";

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

  // --- capture-health state ---
  const [level, setLevel] = useState(0);            // smoothed live RMS (0-1) for the meter
  const [noSignal, setNoSignal] = useState(false);  // input has flatlined while recording
  const [deviceLabel, setDeviceLabel] = useState<string>("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);  // collapse the meter panel so it can't cover help popups
  const smoothRef = useRef(0);               // EMA of rms for display
  const lowSinceRef = useRef<number | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch { /* ignore */ }
  }, []);

  const processChunk = useCallback(
    async (blob: Blob, startedAt: string, endedAt: string, durationMs: number, peak: number) => {
      try {
        if (durationMs < 1500) return; // ignore sub-2s scraps
        const convId = convIdRef.current;
        // Ambient mode skips silent chunks; conversation mode keeps EVERYTHING (natural pauses).
        if (!convId && meterWorkingRef.current && peak < SILENCE_RMS) {
          await saveSilentOfficeNote({ startedAt, endedAt, durationMs });
          setLastSavedAt(Date.now());
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
        setLastSavedAt(Date.now());
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
      lowSinceRef.current = null;
      levelTimerRef.current = window.setInterval(() => {
        if (ac.state !== "running") return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        meterWorkingRef.current = true;
        if (rms > peakRef.current) peakRef.current = rms;          // per-chunk peak (silence gate)
        // smoothed display level (EMA) + a gentle gain so speech reads ~50-90%
        smoothRef.current = smoothRef.current * 0.6 + rms * 0.4;
        setLevel(Math.min(1, smoothRef.current * 6));
        // no-signal detection: sustained near-zero while recording = dead/muted mic
        if (smoothRef.current < NO_SIGNAL_RMS) {
          if (lowSinceRef.current == null) lowSinceRef.current = Date.now();
          else if (Date.now() - lowSinceRef.current > NO_SIGNAL_MS) setNoSignal(true);
        } else {
          lowSinceRef.current = null;
          setNoSignal(false);
        }
      }, 200);
    } catch { /* best-effort; without it, everything transcribes (safe) */ }
  }, []);

  const turnOn = useCallback(async (useDeviceId?: string) => {
    try {
      const wantId = useDeviceId ?? deviceId;
      const constraint: MediaStreamConstraints = wantId
        ? { audio: { deviceId: { exact: wantId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraint);
      streamRef.current = stream;
      onRef.current = true;
      meterWorkingRef.current = false;
      smoothRef.current = 0;
      lowSinceRef.current = null;
      setNoSignal(false);
      setOn(true);
      setStatus("");
      const track = stream.getAudioTracks()[0];
      setDeviceLabel(track?.label || "default mic");
      const sid = track?.getSettings?.().deviceId;
      if (sid) setDeviceId(sid);
      try { localStorage.setItem(LS_KEY, "1"); if (sid) localStorage.setItem(LS_DEV, sid); } catch { /* ignore */ }
      void refreshDevices();
      startLevelMeter(stream);
      startChunk();
    } catch (e) {
      setStatus(`mic blocked: ${e instanceof Error ? e.message : String(e)}`);
      onRef.current = false;
      setOn(false);
    }
  }, [deviceId, refreshDevices, startChunk, startLevelMeter]);

  const turnOff = useCallback(() => {
    onRef.current = false;
    setOn(false);
    setLevel(0);
    setNoSignal(false);
    try { localStorage.setItem(LS_KEY, "0"); } catch { /* ignore */ }
    if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); // onstop finalizes the partial
    if (acRef.current) { try { void acRef.current.close(); } catch { /* ignore */ } acRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  // Switch the active input device (e.g. to the newly plugged-in mic) without losing the session.
  const switchDevice = useCallback(async (id: string) => {
    setDeviceId(id);
    if (onRef.current) { turnOff(); await turnOn(id); }
  }, [turnOff, turnOn]);

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
    let was = "0", dev = "";
    try { was = localStorage.getItem(LS_KEY) ?? "0"; dev = localStorage.getItem(LS_DEV) ?? ""; } catch { /* ignore */ }
    if (dev) setDeviceId(dev);
    if (was === "1") void turnOn(dev || undefined);
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

  const levelPct = Math.round(level * 100);
  const savedAgo = lastSavedAt ? Math.round((Date.now() - lastSavedAt) / 1000) : null;

  // Live capture-health panel (shown whenever a stream is active). Collapsible so it can be tucked
  // out of the way of the help "?" popups it used to cover (Danny 2026-06-29).
  const healthPanel = on ? (
    <div className="w-[230px] rounded-lg border border-neutral-200 bg-white p-2 shadow">
      <div className="flex items-center justify-between text-[10px] text-neutral-500">
        <span className="flex min-w-0 items-center gap-1">
          {/* a tiny always-visible level pip so a dead mic is obvious even when collapsed */}
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${noSignal ? "bg-red-500" : level > 0.12 ? "bg-emerald-500" : "bg-amber-400"}`} />
          <span className="truncate" title={deviceLabel}>🎚 {deviceLabel || "mic"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span>{levelPct}%</span>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? "Collapse meter" : "Expand meter"}
            className="rounded px-1 leading-none text-neutral-400 hover:text-neutral-700"
          >
            {panelOpen ? "▾" : "▸"}
          </button>
        </span>
      </div>
      {panelOpen ? (
        <>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className={`h-full transition-[width] duration-150 ${noSignal ? "bg-neutral-300" : level > 0.66 ? "bg-red-500" : level > 0.12 ? "bg-emerald-500" : "bg-amber-400"}`}
              style={{ width: `${Math.max(noSignal ? 0 : 2, levelPct)}%` }}
            />
          </div>
          {noSignal ? (
            <div className="mt-1.5 rounded bg-red-50 px-1.5 py-1 text-[10px] font-medium text-red-700">
              ⚠ No input detected — check the mic&apos;s gain dial / mute switch, or pick the right device below.
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-neutral-400">
              {savedAgo != null ? `last chunk saved ${savedAgo < 90 ? `${savedAgo}s` : `${Math.round(savedAgo / 60)}m`} ago` : "first chunk soon…"}
            </div>
          )}
          {devices.length > 1 ? (
            <select
              value={deviceId}
              onChange={(e) => void switchDevice(e.target.value)}
              className="mt-1.5 w-full rounded border border-neutral-300 bg-white px-1 py-0.5 text-[10px] text-neutral-700"
              title="Active input device"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `mic ${d.deviceId.slice(0, 6)}`}</option>
              ))}
            </select>
          ) : null}
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {inConversation ? (
        <button
          type="button"
          onClick={stopConv}
          title="Stop + save this conversation (transcribed + speaker-separated on-prem)"
          className="flex items-center gap-1.5 rounded-full border border-red-500 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" /> ⏹ Stop &amp; save conversation
        </button>
      ) : (
        <>
          {on ? (
            <button
              type="button"
              onClick={turnOff}
              title="Office capture is ON — click to stop (or just close your laptop)"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow ${noSignal ? "border-red-500 bg-red-600 text-white" : "border-red-400 bg-red-50 text-red-700"}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${noSignal ? "bg-white" : "animate-pulse bg-red-600"}`} />
              {noSignal ? "🏢 Office capture — NO INPUT" : "🏢 Office capture ON (always-on)"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void turnOn()}
              title="Start always-on office capture (5-min transcripts → office_notes)"
              className="flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500 shadow hover:bg-neutral-50"
            >
              <span className="inline-block h-2 w-2 rounded-full border border-neutral-400" /> 🏢 Office capture OFF — always-on lane
            </button>
          )}
          <button
            type="button"
            onClick={startConv}
            title="Record a conversation — transcribed + speaker-separated on-prem"
            className="flex items-center gap-1.5 rounded-full border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 shadow hover:bg-blue-50"
          >
            🎙️ Record a conversation (start/stop)
          </button>
        </>
      )}
      {healthPanel}
      {status ? <div className="mt-1 max-w-[230px] text-right text-[10px] text-neutral-600">{status}</div> : null}
    </div>
  );
}
