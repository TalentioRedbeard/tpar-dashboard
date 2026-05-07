"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ackEvent, type AckResult } from "./actions";

const initial: AckResult = { ok: null };

function ActionButton({ label, color, title }: { label: string; color: string; title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      className={`rounded px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${color}`}
    >
      {pending ? "…" : label}
    </button>
  );
}

export function QueueItemActions({ id }: { id: string }) {
  const [state, formAction] = useActionState(ackEvent, initial);

  if (state.ok === true) {
    return <span className="text-xs text-emerald-600">{state.message}</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="disposition" value="actioned" />
        <ActionButton label="Done" color="bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100" title="I worked it / will work it now" />
      </form>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="disposition" value="handled_elsewhere" />
        <ActionButton label="Handled" color="bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100" title="Already handled / no action needed" />
      </form>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="disposition" value="dismissed_noise" />
        <ActionButton label="Dismiss" color="bg-neutral-50 text-neutral-600 ring-neutral-200 hover:bg-neutral-100" title="Noise / classifier was wrong" />
      </form>
      {state.ok === false && (
        <span className="text-[11px] text-red-600">{state.message}</span>
      )}
    </div>
  );
}
