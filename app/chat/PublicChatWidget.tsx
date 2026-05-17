"use client";

// Tulsa Plumbing Pricing Bot — the chat widget.
//
// Talks to public-chat-route. Sticky session_id in localStorage so the
// conversation survives reloads within the 30-min window. Voice-to-text
// via WebKit SpeechRecognition for mobile users who'd rather speak.

import { useEffect, useRef, useState } from "react";

type Reply = {
  kind: "question" | "quote" | "lead_captured" | "human_handoff" | "info" | "error" | "stub";
  content: string;
  range_low_cents?: number;
  range_high_cents?: number;
  service_label?: string;
  lead_id?: string;
  handoff_reason?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  ts: number;
  reply?: Reply;
};

// SpeechRecognition types — same shim pattern as AppGuide
type SpeechRecCtor = new () => SpeechRecInstance;
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
type SpeechWindow = Window & {
  webkitSpeechRecognition?: SpeechRecCtor;
  SpeechRecognition?: SpeechRecCtor;
};

const SESSION_KEY = "tpar-chat-session-id";
const SESSION_TS_KEY = "tpar-chat-session-ts";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — matches edge fn's MAX_SESSION_AGE_MIN

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    const ts = Number(localStorage.getItem(SESSION_TS_KEY) ?? "0");
    if (existing && Date.now() - ts < SESSION_TTL_MS) {
      return existing;
    }
  } catch {
    // localStorage might be blocked (private mode, etc.) — fall through to new
  }
  const fresh = `chat-${crypto.randomUUID()}`;
  try {
    localStorage.setItem(SESSION_KEY, fresh);
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()));
  } catch { /* ignore */ }
  return fresh;
}

function touchSession(): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SESSION_TS_KEY, String(Date.now())); } catch { /* ignore */ }
}

export function PublicChatWidget({
  supabaseUrl,
  supabaseAnonKey,
  phoneDisplay,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  phoneDisplay: string;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi — I'm the Tulsa Plumbing pricing bot. Tell me what's going on and I'll give you a ballpark range. (You can speak using the mic if you'd rather.)",
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const sessionIdRef = useRef<string>("");
  const recRef = useRef<SpeechRecInstance | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Generate session id on mount
  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    touchSession();

    const userMsg: Message = { role: "user", content: text, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);

    try {
      const url = `${supabaseUrl}/functions/v1/public-chat-route`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`,
          "apikey": supabaseAnonKey,
        },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          question: text,
          metadata: {
            referrer: typeof window !== "undefined" ? window.location.pathname : null,
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const reply: Reply = data.reply;
      const botMsg: Message = {
        role: "assistant",
        content: reply.content,
        ts: Date.now(),
        reply,
      };
      setMessages((m) => [...m, botMsg]);

      // If the bot routed to a human emergency, surface the phone prominently
      if (reply.kind === "human_handoff" && reply.handoff_reason === "emergency") {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `📞 Call us right now: ${phoneDisplay}`,
            ts: Date.now() + 1,
          },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Something went wrong (${msg}). You can also call us at ${phoneDisplay}.`);
    } finally {
      setBusy(false);
    }
  }

  function toggleVoice() {
    if (typeof window === "undefined") return;
    const w = window as SpeechWindow;
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec) {
      setError("Voice input isn't supported in this browser. Try Chrome on Android or Safari on iOS.");
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
      if (t) setInput((prev) => (prev ? `${prev} ${t}` : t));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        style={{ minHeight: "320px", maxHeight: "60vh" }}
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-brand-700 text-white"
                  : "bg-neutral-100 text-neutral-900"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-neutral-100 px-4 py-2 text-sm text-neutral-500">
              <span className="inline-block animate-pulse">Thinking…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-neutral-200 bg-white px-3 py-2"
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what's going on…"
            className="w-full rounded-full border border-neutral-300 py-2 pl-4 pr-10 text-sm text-neutral-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            disabled={busy}
            autoFocus
          />
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? "Stop dictation" : "Dictate"}
            title={listening ? "Stop dictation" : "Speak instead of typing"}
            className={`absolute inset-y-0 right-1 my-auto flex h-7 w-8 items-center justify-center rounded text-sm ${
              listening ? "animate-pulse bg-red-100 text-red-700" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            }`}
            disabled={busy}
          >
            {listening ? "●" : "🎙"}
          </button>
        </div>
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
