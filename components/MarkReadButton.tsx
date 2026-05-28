"use client";

import { useTransition } from "react";
import { markNoteRead } from "../app/notes/board-actions";

export function MarkReadButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await markNoteRead(id); })}
      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
    >
      {pending ? "…" : "Mark read"}
    </button>
  );
}
