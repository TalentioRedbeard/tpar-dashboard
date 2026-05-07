"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { triggerSync, type SyncResult } from "@/app/actions/sync-actions";

const initial: SyncResult = { ok: null };

function PendingButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-[10px] uppercase tracking-wide text-neutral-500 hover:text-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? "syncing…" : "↻ update"}
    </button>
  );
}

export function UpdateButton({ source, label }: { source: string; label: string }) {
  const [state, formAction] = useActionState(triggerSync, initial);

  return (
    <div className="flex items-center gap-2">
      <form action={formAction} className="inline">
        <input type="hidden" name="source" value={source} />
        <PendingButton />
      </form>
      {state.ok === true && (
        <span className="text-[10px] text-emerald-600" title={`Before: ${state.before_iso ?? "—"} → After: ${state.after_iso ?? "—"}`}>
          {state.message}
        </span>
      )}
      {state.ok === false && (
        <span className="text-[10px] text-red-600" title={`Source ${label}: ${state.message}`}>
          {state.message}
        </span>
      )}
    </div>
  );
}
