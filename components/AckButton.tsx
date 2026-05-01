// Compact ack/unack button for communication_events. Calls server action;
// optimistic-ish (uses useTransition for pending state).

"use client";

import { useTransition } from "react";
import { ackComm } from "../lib/notes-actions";

export function AckButton({ commId, acked, canWrite = true }: { commId: number; acked: boolean; canWrite?: boolean }) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    const fd = new FormData();
    fd.set("comm_id", String(commId));
    fd.set("action", acked ? "unack" : "ack");
    startTransition(async () => {
      await ackComm(fd);
    });
  }

  if (!canWrite) {
    // Manager view — show the state without the action.
    return (
      <span
        title="Manager view — only Danny or a tech can ack."
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
          acked
            ? "border-neutral-200 bg-neutral-50 text-neutral-500"
            : "border-emerald-200 bg-emerald-50/60 text-emerald-700"
        }`}
      >
        {acked ? "Handled" : "Open"}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
        acked
          ? "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
          : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {isPending ? "…" : acked ? "Re-open" : "Mark handled"}
    </button>
  );
}
