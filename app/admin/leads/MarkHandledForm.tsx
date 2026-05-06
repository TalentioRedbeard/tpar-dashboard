"use client";

import { useTransition } from "react";
import { markLeadHandled, reopenLead } from "./actions";

export function MarkHandledForm({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", String(id));
      await markLeadHandled(fd);
    });
  }
  return (
    <button
      type="button"
      onClick={submit}
      disabled={pending}
      className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
    >
      {pending ? "Marking…" : "Mark handled"}
    </button>
  );
}

export function ReopenForm({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", String(id));
      await reopenLead(fd);
    });
  }
  return (
    <button
      type="button"
      onClick={submit}
      disabled={pending}
      className="text-xs text-neutral-500 hover:underline disabled:opacity-60"
    >
      {pending ? "…" : "Reopen"}
    </button>
  );
}
