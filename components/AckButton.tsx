// Compact ack/unack button for communication_events. Calls server action;
// optimistic-ish (uses useTransition for pending state).

"use client";

import { useTransition } from "react";
import { ackComm } from "../lib/notes-actions";

export function AckButton({ commId, acked }: { commId: number; acked: boolean }) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    const fd = new FormData();
    fd.set("comm_id", String(commId));
    fd.set("action", acked ? "unack" : "ack");
    startTransition(async () => {
      await ackComm(fd);
    });
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
