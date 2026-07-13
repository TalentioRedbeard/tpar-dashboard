"use client";

// One flag in the adjudication queue: the what-and-why, who raised it, its
// age, and one-tap dispositions (Fixed / Not a problem / Made a task / Needs
// Danny). Anti-stall law: if it takes more than a minute, the disposition is
// "Made a task" and it leaves this queue.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adjudicateFlag } from "../../../lib/flag-actions";
import { flagTypeMeta, flagEntityHref, type DataFlag } from "../../../lib/flag-types";

function ageLabel(iso: string): { text: string; days: number } {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return { text: days === 0 ? "today" : `${days}d`, days };
}

export function FlagRow({ flag }: { flag: DataFlag }) {
  const meta = flagTypeMeta(flag.flag_type);
  const href = flagEntityHref(flag);
  const age = ageLabel(flag.created_at);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function act(verb: "resolved" | "dismissed" | "promoted" | "needs_danny") {
    if (pending) return;
    startTransition(async () => {
      const r = await adjudicateFlag({ id: flag.id, verb, resolutionNote: note });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  const verbBtn = "rounded-md px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-40";

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-xl leading-none">{meta.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-neutral-500">{meta.label}</span>
            {href ? (
              <Link href={href} className="truncate text-sm font-semibold text-brand-800 hover:underline">
                {flag.entity_label ?? flag.entity_id}
              </Link>
            ) : (
              <span className="truncate text-sm font-semibold text-neutral-900">{flag.entity_label ?? flag.entity_id}</span>
            )}
            {flag.status === "in_review" ? (
              <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">with Danny</span>
            ) : null}
            <span className={`ml-auto shrink-0 text-xs font-semibold ${age.days >= 7 ? "text-red-600" : age.days >= 3 ? "text-amber-600" : "text-neutral-500"}`}>
              {age.text}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">{flag.note}</p>
          <p className="mt-0.5 text-xs text-neutral-500">raised by {flag.created_by.split("@")[0]}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" disabled={pending} onClick={() => act("resolved")}
              className={`${verbBtn} bg-emerald-600 text-white hover:bg-emerald-700`}>✓ Fixed</button>
            <button type="button" disabled={pending} onClick={() => act("dismissed")}
              className={`${verbBtn} bg-neutral-200 text-neutral-700 hover:bg-neutral-300`}>Not a problem</button>
            <button type="button" disabled={pending} onClick={() => act("promoted")}
              className={`${verbBtn} bg-brand-700 text-white hover:bg-brand-800`}>📋 Made a task</button>
            {flag.status !== "in_review" ? (
              <button type="button" disabled={pending} onClick={() => act("needs_danny")}
                className={`${verbBtn} bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300 hover:bg-amber-200`}>Needs Danny</button>
            ) : null}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional note with your call…"
              className="min-w-40 flex-1 rounded-md border border-neutral-200 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
            />
          </div>
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
      </div>
    </li>
  );
}
