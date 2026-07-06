"use client";

// PushToDanny — the quiet escalation footer under an Ask answer (the
// AskBar's inline result AND /ask — both the structured AskResult card and
// the legacy ask-tpar narrative). "Not settled? Push it to Danny." expands
// into two clearly-framed choices (the same framed-tile family as /how-to
// and the daily-wrap card):
//
//   ⏳ Can wait     → ask-escalate urgency:'can_wait' → Danny's phone gets a
//                     TTS call reading the question (+ it lands in writing).
//   🚨 Need him now → one extra confirm tap ("Yes, call me now") →
//                     urgency:'urgent' → bridge: the app calls the TECH's
//                     phone first, then connects Danny.
//
// The ask-escalate edge fn owns cooldowns + phone lookup; this component
// renders exactly what it reports: sent (per mode) / cooldown (minutes
// remaining) / no_phone_on_file (→ /settings) / generic failure. Server
// action: lib/ask-escalate-actions.ts (service-role lane, signed-in gate).
// Phone-first: big full-width tap targets, one action per tile.

import Link from "next/link";
import { useState, useTransition } from "react";
import { pushToDanny, type PushUrgency } from "../lib/ask-escalate-actions";

type Phase =
  | { kind: "idle" }
  | { kind: "choices" }
  | { kind: "confirm_urgent" }
  | { kind: "sending"; urgency: PushUrgency }
  | { kind: "sent"; mode: "tts_call" | "bridge" }
  | { kind: "cooldown"; retryAfterS: number }
  | { kind: "no_phone"; hint: string | null }
  | { kind: "failed"; message: string };

export function PushToDanny({
  question,
  answerSnippet,
  pageContext,
}: {
  /** The question that produced this answer — sent verbatim to Danny. */
  question: string;
  /** First ~200 chars of the answer, for his context. */
  answerSnippet?: string | null;
  /** Where the tech was. Defaults to the live URL at tap time. */
  pageContext?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function send(urgency: PushUrgency) {
    if (phase.kind === "sending") return;
    setPhase({ kind: "sending", urgency });
    startTransition(async () => {
      // Explicit prop when the surface knows its context (AskBar passes the
      // same string it gave the brain); otherwise the on-screen URL now.
      const ctx =
        (pageContext ?? "").trim() ||
        (typeof window !== "undefined" ? window.location.pathname + window.location.search : "");
      const snippet = (answerSnippet ?? "").trim();
      const r = await pushToDanny({
        question,
        answerSnippet: snippet ? snippet.slice(0, 200) : undefined,
        urgency,
        pageContext: ctx || undefined,
      });
      if (r.ok) setPhase({ kind: "sent", mode: r.mode });
      else if (r.error === "cooldown") setPhase({ kind: "cooldown", retryAfterS: r.retryAfterS });
      else if (r.error === "no_phone_on_file") setPhase({ kind: "no_phone", hint: r.hint });
      else setPhase({ kind: "failed", message: r.message });
    });
  }

  let body: React.ReactNode;

  if (phase.kind === "idle") {
    body = (
      <button
        type="button"
        onClick={() => setPhase({ kind: "choices" })}
        className="-mx-2 rounded-lg px-2 py-2 text-left text-xs text-neutral-400 transition hover:bg-neutral-50 hover:text-neutral-700"
      >
        Not settled?{" "}
        <span className="font-medium underline decoration-neutral-300 underline-offset-2">Push it to Danny.</span>
      </button>
    );
  } else if (phase.kind === "choices") {
    body = (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-neutral-600">Push it to Danny</span>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="ml-auto rounded px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-700"
          >
            never mind
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => send("can_wait")}
            className="rounded-2xl border-2 border-brand-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:bg-brand-50/40 active:scale-[0.99]"
          >
            <span aria-hidden className="text-2xl leading-none">⏳</span>
            <span className="mt-1.5 block text-sm font-bold text-neutral-900">Can wait</span>
            <span className="mt-0.5 block text-xs leading-snug text-neutral-600">
              Danny&apos;s phone reads him your question; he gets it in writing too.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: "confirm_urgent" })}
            className="rounded-2xl border-2 border-red-200 bg-white p-4 text-left shadow-sm transition hover:border-red-300 hover:bg-red-50/40 active:scale-[0.99]"
          >
            <span aria-hidden className="text-2xl leading-none">🚨</span>
            <span className="mt-1.5 block text-sm font-bold text-neutral-900">Need him now</span>
            <span className="mt-0.5 block text-xs leading-snug text-neutral-600">
              The app calls YOUR phone first, then connects Danny — answer when it rings.
            </span>
          </button>
        </div>
      </div>
    );
  } else if (phase.kind === "confirm_urgent") {
    body = (
      <div className="rounded-2xl border-2 border-red-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-2xl leading-none">🚨</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-neutral-900">Call you now, then connect Danny?</div>
            <p className="mt-0.5 text-xs leading-snug text-neutral-600">
              The app calls YOUR phone first, then connects Danny — answer when it rings.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => send("urgent")}
            className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.99]"
          >
            Yes, call me now
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: "choices" })}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Back
          </button>
        </div>
      </div>
    );
  } else if (phase.kind === "sending") {
    body = (
      <div className="rounded-2xl border-2 border-brand-200 bg-white p-4 text-sm font-medium text-neutral-700 shadow-sm">
        {phase.urgency === "urgent" ? "☎️ Setting up your call…" : "📤 Pushing your question to Danny…"}
      </div>
    );
  } else if (phase.kind === "sent") {
    body = (
      <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 shadow-sm">
        <div className="text-sm font-semibold text-emerald-800">
          {phase.mode === "bridge"
            ? "📱 Your phone is about to ring — pick up and you'll be connected"
            : "📞 Danny's being called with your question"}
        </div>
        {phase.mode === "tts_call" ? (
          <p className="mt-0.5 text-xs text-emerald-700">He gets it in writing too — no need to re-ask.</p>
        ) : null}
      </div>
    );
  } else if (phase.kind === "cooldown") {
    const mins = Math.max(1, Math.ceil(phase.retryAfterS / 60));
    body = (
      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="text-sm font-semibold text-amber-900">⏱ Danny already has a push in flight</div>
        <p className="mt-0.5 text-xs leading-snug text-amber-800">
          {`There's a short gap between pushes so each one lands — try again in about ${mins} minute${mins === 1 ? "" : "s"}.`}
        </p>
        <button
          type="button"
          onClick={() => setPhase({ kind: "idle" })}
          className="mt-3 rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          OK
        </button>
      </div>
    );
  } else if (phase.kind === "no_phone") {
    body = (
      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="text-sm font-semibold text-amber-900">📵 No phone number on file for you</div>
        <p className="mt-0.5 text-xs leading-snug text-amber-800">
          {phase.hint || "Add your phone in Settings first — then the app can call you."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href="/settings"
            className="rounded-full bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Open Settings
          </Link>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 shadow-sm">
        <div className="text-sm font-semibold text-red-800">Couldn&apos;t push it to Danny</div>
        <p className="mt-0.5 text-xs leading-snug text-red-700">{phase.message}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPhase({ kind: "choices" })}
            className="rounded-full bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return <div className="mt-4 border-t border-neutral-100 pt-3">{body}</div>;
}
