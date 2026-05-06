"use client";

import { useFormStatus } from "react-dom";

export function UpdateButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-[10px] uppercase tracking-wide text-neutral-500 hover:text-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      aria-label={`Update ${label}`}
      title={`Manually trigger ${label} sync`}
    >
      {pending ? "syncing…" : "↻ update"}
    </button>
  );
}
