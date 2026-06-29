"use client";

// /admin/drift "ask the system" box — the IT-bot Phase 2 query UI.
// Grounded Q&A (ask) + claim adjudication (verify) over the LIVE technical estate,
// answered by Claude reasoning over ONLY the retrieved facts. Admin-only (page-gated
// + re-checked in the action).

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { askTheSystem, type AskResult, type AskMode } from "./ask-actions";

const initial: AskResult = { ok: null };

const EXAMPLES: Record<AskMode, string[]> = {
  ask: [
    "What writes to appointments_master and how often does it sync?",
    "Is anything broken in data freshness right now?",
    "What does the daily-sync cron do?",
  ],
  verify: [
    "The system has about 63 edge functions.",
    "SalesAsk is still actively syncing recordings.",
    "There are 0 open drift findings.",
  ],
};

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function statusClasses(s: string): string {
  if (s === "confirmed") return "bg-emerald-100 text-emerald-800 ring-emerald-300";
  if (s === "contradicted") return "bg-red-100 text-red-800 ring-red-300";
  if (s === "stale") return "bg-amber-100 text-amber-800 ring-amber-300";
  return "bg-neutral-100 text-neutral-600 ring-neutral-300"; // unknown
}

function SubmitButton({ mode }: { mode: AskMode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (mode === "verify" ? "checking…" : "asking…") : mode === "verify" ? "Verify claim" : "Ask"}
    </button>
  );
}

function Sources({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {items.map((s, i) => (
        <span key={i} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">{s}</span>
      ))}
    </div>
  );
}

function ResultCard({ state }: { state: Extract<AskResult, { ok: true }> }) {
  const r = state.result;
  const sources = asStringArray(r.sources_used);
  const retrievalNote = Object.entries(state.retrieval)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
    .join(" · ");

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-2 text-xs text-neutral-400">
        {state.mode === "verify" ? "Verifying" : "Asked"}: <span className="text-neutral-600">{state.question}</span>
      </div>

      {state.mode === "verify" ? (
        <>
          <div className="flex items-center gap-2">
            <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase ring-1 ring-inset ${statusClasses(String(r.status ?? "unknown"))}`}>
              {String(r.status ?? "unknown")}
            </span>
            {r.live_value ? <span className="text-sm text-neutral-700">Live: {String(r.live_value)}</span> : null}
          </div>
          {r.explanation ? <p className="mt-2 text-sm leading-relaxed text-neutral-800">{String(r.explanation)}</p> : null}
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{String(r.answer ?? "")}</p>
          {r.confidence ? (
            <div className="mt-2 text-[11px] text-neutral-400">confidence: {String(r.confidence)}</div>
          ) : null}
          {asStringArray(r.caveats).length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-700">
              {asStringArray(r.caveats).map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          ) : null}
        </>
      )}

      <Sources items={sources} />
      {retrievalNote ? <div className="mt-3 border-t border-neutral-100 pt-2 text-[10px] text-neutral-400">grounded on {retrievalNote}</div> : null}
    </div>
  );
}

export function AskBox() {
  const [state, formAction] = useActionState(askTheSystem, initial);
  const [mode, setMode] = useState<AskMode>("ask");
  const [question, setQuestion] = useState("");

  return (
    <section className="mb-8 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Ask the system</h2>
          <p className="text-xs text-neutral-500">
            Grounded in the live estate (edge fns, crons, tables, ontology, drift, freshness, confirmed claims) — answered by Claude over those facts only.
          </p>
        </div>
        <div className="flex rounded-lg border border-neutral-300 bg-white p-0.5 text-xs">
          {(["ask", "verify"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 font-medium capitalize ${mode === m ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <form action={formAction}>
        <input type="hidden" name="mode" value={mode} />
        <textarea
          name="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder={mode === "verify" ? "Paste a claim to check against live facts…" : "Ask about the technical estate…"}
          className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SubmitButton mode={mode} />
          <span className="text-[11px] text-neutral-400">try:</span>
          {EXAMPLES[mode].map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setQuestion(ex)}
              className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
            >
              {ex.length > 42 ? ex.slice(0, 40) + "…" : ex}
            </button>
          ))}
        </div>
      </form>

      {state.ok === true ? <ResultCard state={state} /> : null}
      {state.ok === false ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</div>
      ) : null}
    </section>
  );
}
