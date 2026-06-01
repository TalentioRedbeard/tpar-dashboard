"use client";

// Reusable speech-to-text mic button. Mirrors the WebKit SpeechRecognition
// pattern already used in AppGuide.tsx (Chrome on Android, Safari iOS). Calls
// onTranscript with the recognized text; the caller decides whether to append
// or replace. Falls back gracefully (alert) where the API is unavailable.

import { useRef, useState } from "react";

type SpeechRecInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecCtor = new () => SpeechRecInstance;
type SpeechWindow = Window & {
  webkitSpeechRecognition?: SpeechRecCtor;
  SpeechRecognition?: SpeechRecCtor;
};

export function SpeechToTextButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecInstance | null>(null);

  function toggle() {
    if (typeof window === "undefined") return;
    const w = window as SpeechWindow;
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec) {
      alert("Voice input not supported in this browser. Try Chrome or Safari on mobile.");
      return;
    }
    if (listening && recRef.current) {
      recRef.current.stop();
      setListening(false);
      return;
    }
    const rec = new Rec();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      const t = ev.results?.[0]?.[0]?.transcript ?? "";
      if (t) onTranscript(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
        listening
          ? "border-red-300 bg-red-50 text-red-700 animate-pulse"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
      }`}
      title="Dictate (speech-to-text)"
    >
      {listening ? "● Listening…" : "🎤 Speak"}
    </button>
  );
}
