"use client";

// MessageOfficeCard — the "📨 Message the office" card on /me. A quick typed
// note straight to the office (or to Danny) via the team-push edge fn — no
// phone tag, no hunting for a number. Same clearly-framed family as the
// quick-action tiles + DailyWrapCard (Field Doctrine rollout: "each tile
// clearly framed and labeled").
//
// Collapsed by default to a single framed row so My Day stays calm; tap to
// expand into: recipient chips [🏢 The office] [👑 Danny] (office default),
// a 3-row textarea, Send. States: sending → sent (auto-collapse ~2.5s) /
// cooldown / failure (+ Try again, text preserved). The team-push fn owns
// the cooldown + delivery; server action: lib/team-push-actions.ts.

import { useEffect, useRef, useState, useTransition } from "react";
import { pushTeamMessage, type TeamPushRecipient } from "../lib/team-push-actions";

type Phase =
  | { kind: "collapsed" }
  | { kind: "compose" }
  | { kind: "sending" }
  | { kind: "sent"; to: TeamPushRecipient }
  | { kind: "cooldown" }
  | { kind: "failed"; message: string };

export function MessageOfficeCard() {
  const [phase, setPhase] = useState<Phase>({ kind: "collapsed" });
  const [to, setTo] = useState<TeamPushRecipient>("office");
  const [text, setText] = useState("");
  const [, startTransition] = useTransition();
  // Double-send guard: phase state alone can lag a rapid double-tap (state
  // updates are async), so the in-flight flag is a ref checked synchronously.
  const inFlightRef = useRef(false);

  // Sent → auto-collapse after ~2.5s, back to the calm row with a clean slate.
  useEffect(() => {
    if (phase.kind !== "sent") return;
    const t = window.setTimeout(() => {
      setText("");
      setTo("office");
      setPhase({ kind: "collapsed" });
    }, 2500);
    return () => window.clearTimeout(t);
  }, [phase.kind]);

  function send() {
    if (inFlightRef.current || phase.kind === "sending") return;
    if (!text.trim()) return;
    inFlightRef.current = true;
    setPhase({ kind: "sending" });
    startTransition(async () => {
      const r = await pushTeamMessage({
        to,
        text,
        pageContext:
          typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined,
      });
      inFlightRef.current = false;
      if (r.ok) setPhase({ kind: "sent", to });
      else if (r.error === "cooldown") setPhase({ kind: "cooldown" });
      else setPhase({ kind: "failed", message: r.message });
    });
  }

  // Collapsed: one framed row in the tile family — tap to expand.
  if (phase.kind === "collapsed") {
    return (
      <section className="mb-8">
        <button
          type="button"
          onClick={() => setPhase({ kind: "compose" })}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-brand-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-300 hover:bg-brand-50/30 hover:shadow"
        >
          <span className="text-3xl leading-none" aria-hidden>📨</span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-brand-900">Message the office</span>
            <span className="mt-0.5 block text-xs text-neutral-600">
              A note straight to the office, or to Danny — no phone tag.
            </span>
          </span>
        </button>
      </section>
    );
  }

  const sending = phase.kind === "sending";
  const chipBase = "rounded-full px-3 py-1.5 text-xs transition";
  const chipOn = `${chipBase} border-2 border-brand-400 bg-brand-50 font-semibold text-brand-900`;
  const chipOff = `${chipBase} border border-neutral-300 bg-white font-medium text-neutral-600 hover:bg-neutral-50`;

  let body: React.ReactNode;
  if (phase.kind === "sent") {
    body = (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
        {phase.to === "danny" ? "Sent — 👑 Danny has it" : "Sent — 🏢 the office has it"}
      </div>
    );
  } else if (phase.kind === "cooldown") {
    body = (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="text-sm font-semibold text-amber-900">
          Easy, tiger — a few too many in a row. Give it a couple minutes.
        </div>
        <button
          type="button"
          onClick={() => setPhase({ kind: "compose" })}
          className="mt-2 rounded-full border border-amber-300 bg-white px-4 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          OK
        </button>
      </div>
    );
  } else if (phase.kind === "failed") {
    body = (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
        <div className="text-sm font-semibold text-red-800">Couldn&apos;t send it</div>
        <p className="mt-0.5 text-xs leading-snug text-red-700">{phase.message}</p>
        <button
          type="button"
          onClick={() => setPhase({ kind: "compose" })}
          className="mt-2 rounded-full bg-brand-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
        >
          Try again
        </button>
      </div>
    );
  } else {
    // compose + sending share the form; sending just disables it.
    body = (
      <div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTo("office")}
            disabled={sending}
            aria-pressed={to === "office"}
            className={to === "office" ? chipOn : chipOff}
          >
            🏢 The office
          </button>
          <button
            type="button"
            onClick={() => setTo("danny")}
            disabled={sending}
            aria-pressed={to === "danny"}
            className={to === "danny" ? chipOn : chipOff}
          >
            👑 Danny
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={1000}
          disabled={sending}
          placeholder="What do they need to know?"
          className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-brand-400 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500"
        />
        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "📤 Sending…" : "Send"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="mb-8">
      <div className="rounded-2xl border-2 border-brand-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-start gap-2 border-b border-neutral-100 pb-2">
          <span className="text-3xl leading-none" aria-hidden>📨</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-brand-900">Message the office</div>
            <p className="text-xs text-neutral-600">A note straight to the office, or to Danny — no phone tag.</p>
          </div>
          {phase.kind === "compose" ? (
            <button
              type="button"
              onClick={() => setPhase({ kind: "collapsed" })}
              className="ml-auto shrink-0 rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-700"
            >
              never mind
            </button>
          ) : null}
        </div>
        {body}
      </div>
    </section>
  );
}
