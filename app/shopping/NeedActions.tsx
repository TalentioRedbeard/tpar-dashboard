"use client";

import { useTransition } from "react";
import { fulfillNeed, cancelNeed } from "./actions";

export function NeedActions({ needId }: { needId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await fulfillNeed({ need_id: needId });
          });
        }}
        className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
        title="Mark fulfilled"
      >
        ✓ Done
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Cancel this need?")) return;
          startTransition(async () => {
            await cancelNeed({ need_id: needId });
          });
        }}
        className="rounded-md bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-100 disabled:opacity-50"
        title="Cancel need"
      >
        ✕
      </button>
    </div>
  );
}
