"use client";

// JobFinder — "What job(s) are you looking for?" text/voice resolver with
// ambient-signal-biased scoring. Two render modes:
//   - mode="picker"  → top candidate gets action buttons (Estimate, Receipt, …).
//                       Used on /find and embeds.
//   - mode="filter"  → returns a flat list, no action buttons. Caller decides
//                       what to do (e.g. render a custom list below).
//
// Voice input: WebKit SpeechRecognition (Chrome on Android, Safari iOS).
// Falls back gracefully if unavailable.

import { useState, useRef, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { findJobs, type FinderCandidate, type AmbientSnapshot } from "../app/find/actions";

type Mode = "picker" | "filter";

type ActionTarget =
  | "estimate"   // /job/{id}/estimate/new
  | "receipt"    // /receipt?job={id}
  | "photo"      // /photos/new?job={id}  (fallback /job/{id} if route absent)
  | "voice"      // /voice-notes/new?job={id}
  | "open";      // /job/{id}

const ACTION_LABELS: Record<ActionTarget, string> = {
  estimate: "Estimate",
  receipt:  "Receipt",
  photo:    "Photo",
  voice:    "Voice note",
  open:     "Open job",
};

function actionHref(action: ActionTarget, hcp_job_id: string): string {
  switch (action) {
    case "estimate": return `/job/${hcp_job_id}/estimate/new`;
    case "receipt":  return `/receipt?job=${hcp_job_id}`;
    case "photo":    return `/job/${hcp_job_id}#photos`;
    case "voice":    return `/voice-notes/new?job=${hcp_job_id}`;
    case "open":     return `/job/${hcp_job_id}`;
  }
}

function fmtChi(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const min = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)}m ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / (24 * 60))}d ago`;
}

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

export function JobFinder({
  mode = "picker",
  actions = ["estimate", "receipt", "photo", "voice", "open"],
  initialQuery = "",
  onSelect,
  showAmbient = true,
}: {
  mode?: Mode;
  actions?: ActionTarget[];
  initialQuery?: string;
  /** Called when picker mode top result has an action clicked. Optional;
   *  if omitted the action navigates to the right URL. */
  onSelect?: (cand: FinderCandidate, action: ActionTarget) => void;
  /** Toggle the "where you are / today / last call" header. Off when used
   *  as an inline filter on /jobs (saves space). */
  showAmbient?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [candidates, setCandidates] = useState<FinderCandidate[]>([]);
  const [ambient, setAmbient] = useState<AmbientSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecInstance | null>(null);

  // Debounced search — fires on mount with empty query (returns ambient + today's jobs),
  // then re-fires as the user types.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      findJobs({ query })
        .then((res) => {
          if (cancelled) return;
          setCandidates(res.candidates);
          setAmbient(res.ambient);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query.length === 0 ? 0 : 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Voice input setup
  function toggleVoice() {
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
      if (t) setQuery(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => { console.warn("speech rec error:", e); setListening(false); };
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  const top = candidates[0];
  const rest = candidates.slice(1, 6);

  return (
    <div className="space-y-4">
      {/* Input bar */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <label htmlFor="jobfinder-q" className="mb-2 block text-xs font-medium text-neutral-500">
          What job(s) are you looking for?
        </label>
        <div className="flex items-center gap-2">
          <input
            id="jobfinder-q"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='"trotzuk" / "1342 east 25th" / "current" / leave empty for today'
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-base text-neutral-800 placeholder:text-neutral-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            autoComplete="off"
            autoFocus
          />
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? "Stop listening" : "Talk to find a job"}
            className={`h-10 w-10 shrink-0 rounded-md text-xl ${listening ? "bg-red-100 text-red-700 animate-pulse" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >
            {listening ? "●" : "🎙"}
          </button>
        </div>
      </div>

      {/* Ambient strip */}
      {showAmbient && ambient ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 text-xs text-neutral-700">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ambient.van ? (
              <span>
                <strong className="text-neutral-900">Van:</strong>{" "}
                {ambient.van.label ?? "—"}
                {ambient.van.stopped_at ? <span className="text-neutral-500"> (stopped {relTime(ambient.van.stopped_at)})</span> : null}
              </span>
            ) : null}
            <span><strong className="text-neutral-900">Today:</strong> {ambient.today_count} appt{ambient.today_count === 1 ? "" : "s"}</span>
            {ambient.recent_call_customer ? (
              <span>
                <strong className="text-neutral-900">Last call:</strong> {ambient.recent_call_customer} ({relTime(ambient.recent_call_when)})
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Results */}
      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Looking…</div>
      ) : candidates.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          {query ? `No matches for "${query}". Try a name, an address, or just leave it empty for today's jobs.` : "Nothing on your schedule today. Type a customer name above."}
        </div>
      ) : mode === "picker" && top ? (
        <>
          <TopCandidateCard cand={top} actions={actions} onSelect={onSelect} />
          {rest.length > 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white">
              <div className="border-b border-neutral-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Also possible
              </div>
              <ul className="divide-y divide-neutral-100">
                {rest.map((c) => (
                  <CandidateRow key={c.hcp_job_id} cand={c} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        // filter mode → flat list
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <ul className="divide-y divide-neutral-100">
            {candidates.map((c) => (
              <CandidateRow key={c.hcp_job_id} cand={c} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TopCandidateCard({
  cand,
  actions,
  onSelect,
}: {
  cand: FinderCandidate;
  actions: ActionTarget[];
  onSelect?: (cand: FinderCandidate, action: ActionTarget) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-brand-300 bg-brand-50/30 p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-neutral-900">
          ★ {cand.customer_name ?? "—"}
          {cand.invoice_number ? <span className="ml-2 font-mono text-sm font-normal text-neutral-500">#{cand.invoice_number}</span> : null}
        </h3>
        {cand.due_amount ? (
          <span className="font-mono text-sm font-semibold text-red-700">${cand.due_amount.toFixed(0)} owed</span>
        ) : null}
      </div>
      <div className="mt-1 text-sm text-neutral-700">
        {cand.street ? <span>{cand.street}, {cand.city ?? ""}</span> : null}
        {cand.tech_primary_name ? <span className="ml-2 text-neutral-500">· {cand.tech_primary_name} primary</span> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
        {cand.scheduled_start ? <span>Sched {fmtChi(cand.scheduled_start)}</span> : null}
        {cand.started_at ? <span className="text-emerald-700">Started {relTime(cand.started_at)}</span> : null}
        {cand.finished_at ? <span className="text-neutral-500">Finished {relTime(cand.finished_at)}</span> : null}
        {cand.reasons.length > 0 ? <span className="text-brand-700">· {cand.reasons.join(" · ")}</span> : null}
      </div>

      {cand.nudges.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {cand.nudges.map((n, i) => (
            <li key={i} className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900">⚡ {n}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((a) => (
          <ActionButton key={a} action={a} cand={cand} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function ActionButton({
  action,
  cand,
  onSelect,
}: {
  action: ActionTarget;
  cand: FinderCandidate;
  onSelect?: (cand: FinderCandidate, action: ActionTarget) => void;
}) {
  const href = actionHref(action, cand.hcp_job_id);
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(cand, action)}
        className="rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
      >
        {ACTION_LABELS[action]}
      </button>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
    >
      {ACTION_LABELS[action]}
    </Link>
  );
}

function CandidateRow({ cand }: { cand: FinderCandidate }): ReactNode {
  return (
    <li className="hover:bg-neutral-50">
      <Link href={`/job/${cand.hcp_job_id}`} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
        <div>
          <span className="font-medium text-neutral-900">{cand.customer_name ?? "—"}</span>
          {cand.invoice_number ? <span className="ml-2 font-mono text-xs text-neutral-500">#{cand.invoice_number}</span> : null}
          {cand.street ? <span className="ml-2 text-neutral-600">{cand.street}</span> : null}
        </div>
        <div className="text-xs text-neutral-500">
          {cand.scheduled_start ? fmtChi(cand.scheduled_start) : (cand.job_date ?? "—")}
          {cand.reasons[0] ? <span className="ml-2 text-brand-700">· {cand.reasons[0]}</span> : null}
        </div>
      </Link>
    </li>
  );
}
