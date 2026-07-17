"use client";

// The feedback triage queue (spec §3c): Danny's (or Madisson's) daily sitting
// is approve/edit/send — never compose-from-scratch. Rows carry the analyzer's
// draft; three verbs; apply-to-cluster makes ONE task for repeat asks; kudos
// live in a collapsed "Good words" strip exempt from rot stats.

import { useMemo, useState, useTransition } from "react";
import { decideFeedbackItem, implementFeedbackItems } from "./feedback-actions";

export type QueueItem = {
  id: string;
  tech: string;
  sourceKind: string;      // wrap_requirement | wrap_blocker | wrap_highlight
  wrapDate: string;        // YYYY-MM-DD
  summary: string;
  category: string | null;
  clusterKey: string | null;
  suggestedResponse: string | null;
  ageDays: number;
  isKudos: boolean;
};

const KIND_EMOJI: Record<string, string> = {
  wrap_requirement: "🧰",
  wrap_blocker: "🧱",
  wrap_highlight: "🌟",
};

function ageTone(days: number, kudos: boolean): string {
  if (kudos) return "text-neutral-400";
  if (days >= 2) return "text-red-700 font-semibold";
  if (days >= 1) return "text-amber-700 font-medium";
  return "text-neutral-400";
}

function Row({ item, clusterMates, techNames }: { item: QueueItem; clusterMates: QueueItem[]; techNames: string[] }) {
  const [note, setNote] = useState(item.suggestedResponse ?? "");
  const [mode, setMode] = useState<"idle" | "task" | "explain">("idle");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, label: string) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (r.ok) setDone(label);
      else setErr(r.error ?? "Failed.");
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-800">
        ✓ {done} — {item.tech} sees it on their Home page{done !== "Sent thanks" ? " (and by DM if they have one)" : ""}.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-neutral-900">
            <span aria-hidden className="mr-1">{KIND_EMOJI[item.sourceKind] ?? "📣"}</span>
            <span className="italic">&ldquo;{item.summary}&rdquo;</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
            <span>{item.wrapDate}</span>
            {item.category ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600">{item.category}</span> : null}
            <span className={ageTone(item.ageDays, item.isKudos)}>
              {item.ageDays === 0 ? "today" : `waiting ${item.ageDays}d`}
            </span>
            {clusterMates.length > 0 ? (
              <span className="text-brand-700">also raised {clusterMates.map((m) => m.wrapDate.slice(5)).join(", ")}</span>
            ) : null}
          </div>
        </div>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="your answer, in your words…"
        className="mt-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
      />
      {item.suggestedResponse ? (
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400">Draft — edit or replace; it sends in your name.</p>
      ) : (
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-amber-500">No draft (triage skipped) — write the answer.</p>
      )}

      {mode === "task" ? (
        <div className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-brand-50/50 p-2.5">
          {clusterMates.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-neutral-600">Same thing raised elsewhere — fold into this ONE task:</div>
              {clusterMates.map((m) => (
                <label key={m.id} className="flex items-start gap-2 text-xs text-neutral-700">
                  <input type="checkbox" checked={checked.has(m.id)}
                    onChange={(e) => setChecked((p) => { const n = new Set(p); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })}
                    className="mt-0.5 h-3.5 w-3.5" />
                  <span>[{m.tech} · {m.wrapDate.slice(5)}] {m.summary.slice(0, 90)}</span>
                </label>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-neutral-600">
              Assign to{" "}
              <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs">
                <option value="">— me —</option>
                {techNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" disabled={pending}
              onClick={() => run(() => implementFeedbackItems({ anchorId: item.id, alsoIds: [...checked], note: note.trim() || undefined, assignTo: assignTo || undefined }), "Task made")}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              {pending ? "…" : "Create the task"}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="text-xs text-neutral-500 hover:underline">cancel</button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.isKudos ? (
          <button type="button" disabled={pending || !note.trim()}
            onClick={() => run(() => decideFeedbackItem({ id: item.id, decision: "reply", note }), "Sent thanks")}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {pending ? "…" : "🌟 Send thanks"}
          </button>
        ) : (
          <>
            <button type="button" disabled={pending || !note.trim()}
              onClick={() => run(() => decideFeedbackItem({ id: item.id, decision: "reply", note }), "Replied")}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? "…" : "✓ Reply"}
            </button>
            <button type="button" disabled={pending}
              onClick={() => setMode(mode === "task" ? "idle" : "task")}
              className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-50">
              🔨 Make a task
            </button>
            <button type="button" disabled={pending || (mode === "explain" && !note.trim())}
              onClick={() => {
                if (mode !== "explain") { setMode("explain"); return; }
                run(() => decideFeedbackItem({ id: item.id, decision: "explain", note }), "Explained");
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${mode === "explain" ? "bg-neutral-800 text-white hover:bg-neutral-900" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
              {mode === "explain" ? "Confirm: can't do it" : "Can't do it — here's why"}
            </button>
          </>
        )}
        {err ? <span className="text-xs text-red-700">{err}</span> : null}
      </div>
    </div>
  );
}

export function FeedbackQueue({ items, techNames }: { items: QueueItem[]; techNames: string[] }) {
  const [showKudos, setShowKudos] = useState(false);

  const { main, kudos, byTech, clusterIndex } = useMemo(() => {
    const main = items.filter((i) => !i.isKudos);
    const kudos = items.filter((i) => i.isKudos);
    const byTech = new Map<string, QueueItem[]>();
    for (const i of main) {
      if (!byTech.has(i.tech)) byTech.set(i.tech, []);
      byTech.get(i.tech)!.push(i);
    }
    const clusterIndex = new Map<string, QueueItem[]>();
    for (const i of items) {
      if (!i.clusterKey) continue;
      if (!clusterIndex.has(i.clusterKey)) clusterIndex.set(i.clusterKey, []);
      clusterIndex.get(i.clusterKey)!.push(i);
    }
    return { main, kudos, byTech, clusterIndex };
  }, [items]);

  const mates = (i: QueueItem) =>
    (i.clusterKey ? (clusterIndex.get(i.clusterKey) ?? []) : []).filter((m) => m.id !== i.id && !m.isKudos);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
        🎉 Every piece of feedback is answered. The loop is closed — that&apos;s the goal state.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {[...byTech.entries()].map(([tech, rows]) => (
        <section key={tech}>
          <h3 className="mb-2 text-sm font-bold text-neutral-800">{tech} <span className="font-normal text-neutral-400">({rows.length})</span></h3>
          <div className="space-y-2">
            {rows.map((i) => <Row key={i.id} item={i} clusterMates={mates(i)} techNames={techNames} />)}
          </div>
        </section>
      ))}

      {kudos.length > 0 ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3">
          <button type="button" onClick={() => setShowKudos((v) => !v)} className="flex w-full items-center justify-between text-sm font-semibold text-emerald-900">
            <span>🌟 Good words ({kudos.length}) — no rot clock on these</span>
            <span className="text-xs">{showKudos ? "hide ▴" : "show ▾"}</span>
          </button>
          {showKudos ? (
            <div className="mt-2 space-y-2">
              {kudos.map((i) => <Row key={i.id} item={i} clusterMates={[]} techNames={techNames} />)}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
