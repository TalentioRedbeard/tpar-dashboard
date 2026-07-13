"use client";

// FlagButton — two taps to a raised flag: pick the category, say what and why
// (the note is REQUIRED — Danny's rule), context autofilled from the page so
// nothing is retyped. Lives in each entity page's actions bar. Adjudication
// happens on /manage/flags; the flagger sees the outcome back on this page
// via EntityFlags.

import { useState, useTransition } from "react";
import { raiseFlag } from "../lib/flag-actions";
import { FLAG_TYPES } from "../lib/flag-types";

export function FlagButton({
  entityType,
  entityId,
  entityLabel,
}: {
  entityType: string;
  entityId: string;
  entityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [flagType, setFlagType] = useState<string>("question");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "already" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!note.trim() || pending) return;
    startTransition(async () => {
      const r = await raiseFlag({ entityType, entityId, entityLabel, flagType, note });
      if (r.ok) {
        setState(r.already ? "already" : "sent");
        setNote("");
        setTimeout(() => { setOpen(false); setState("idle"); }, 2200);
      } else {
        setState("error");
        setError(r.error);
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setState("idle"); setError(null); }}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:border-amber-300 hover:bg-amber-50"
        title="Something off here? Flag it — say what and why."
      >
        🚩 Flag
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border-2 border-amber-200 bg-white p-3 shadow-lg">
          {state === "sent" || state === "already" ? (
            <p className="py-2 text-sm text-emerald-700">
              {state === "already" ? "Added to the existing flag ✓" : "Flagged ✓"} — it's on the management queue.
            </p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {FLAG_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFlagType(t.key)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      flagType === t.key
                        ? "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300"
                        : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                    }`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What's wrong (or what's the question), and why?"
                rows={3}
                className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none"
              />
              {state === "error" && error ? (
                <p className="mb-2 text-xs text-red-600">{error}</p>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">the why is required</span>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!note.trim() || pending}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-40"
                >
                  {pending ? "Flagging…" : "Raise flag"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
