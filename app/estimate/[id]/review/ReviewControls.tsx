"use client";

// Approve affordance for the AI-estimate review surface. v0 STUB: records that
// a human reviewed this AI draft (+ which option they're approving + an optional
// note) and flips the draft to 'ready'. It does NOT push to HCP — that handoff
// is a separate, deliberate step. Disabled when the estimate has a blocking
// flag UNLESS the reviewer explicitly acknowledges the block first, so a
// block_push / out-of-band price can't be rubber-stamped silently.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveEstimate } from "./actions";

export function ReviewControls({
  id,
  options,
  hasBlock,
  canWrite,
  alreadyReviewed,
}: {
  id: string;
  options: Array<{ label: string; name: string | null; rank: string | null }>;
  hasBlock: boolean;
  canWrite: boolean;
  alreadyReviewed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Default to the first option (lowest rank-priority — typically "good"/A).
  const [optionLabel, setOptionLabel] = useState<string>(options[0]?.label ?? "");
  const [note, setNote] = useState("");
  const [ackBlock, setAckBlock] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const blockedByFlag = hasBlock && !ackBlock;

  function submit() {
    setErr(null);
    start(async () => {
      const res = await approveEstimate({ id, optionLabel: optionLabel || null, note: note.trim() || null });
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  if (!canWrite) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Manager view — read-only. Approving a draft is done by the owner or a tech assigned to this job.
      </div>
    );
  }

  if (done || alreadyReviewed) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="text-sm font-semibold text-emerald-900">Reviewed — marked ready</div>
        <p className="mt-1 text-sm text-emerald-800">
          This draft is marked <span className="font-medium">ready</span>. Pushing the chosen option to HCP is a
          separate step (not wired here yet).
        </p>
      </div>
    );
  }

  const input =
    "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-neutral-900">Approve this draft for the next step</div>
      <p className="mt-1 text-xs text-neutral-500">
        v0: this records that a human reviewed the AI estimate and which option you&apos;re approving, then marks it
        <span className="mx-1 font-medium">ready</span>. It does <span className="font-medium">not</span> push to HCP —
        that&apos;s a deliberate separate step.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-neutral-500">
          Option to approve
          <select value={optionLabel} onChange={(e) => setOptionLabel(e.target.value)} disabled={pending} className={input + " mt-1"}>
            {options.length === 0 ? <option value="">—</option> : null}
            {options.map((o) => (
              <option key={o.label} value={o.label}>
                Option {o.label}
                {o.rank ? ` · ${o.rank}` : ""}
                {o.name ? ` — ${o.name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-500">
          Review note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            placeholder="e.g. confirmed scope with customer; got Winsupply quote"
            className={input + " mt-1"}
          />
        </label>
      </div>

      {hasBlock ? (
        <label className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <input type="checkbox" checked={ackBlock} onChange={(e) => setAckBlock(e.target.checked)} className="mt-0.5" />
          <span>
            This estimate has a <span className="font-semibold">blocking flag</span> (a line is marked do-not-push, or a
            recomputed price is outside the historical band). I&apos;ve reviewed it and the price/scope is correct.
          </span>
        </label>
      ) : null}

      {err ? <div className="mt-2 text-xs text-red-600">{err}</div> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || blockedByFlag || !optionLabel}
          className="rounded-md bg-brand-700 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Approve & mark ready"}
        </button>
        {blockedByFlag ? (
          <span className="text-xs italic text-red-600">Acknowledge the blocking flag above first.</span>
        ) : null}
      </div>
    </div>
  );
}
