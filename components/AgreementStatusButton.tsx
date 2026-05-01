// Compact status-cycle button for a maintenance_agreement row.
// Cycle: active → paused → active. Cancel is a separate explicit action.

"use client";

import { useState, useTransition } from "react";
import { updateAgreementStatus } from "../lib/agreement-actions";

const NEXT: Record<string, string> = {
  active: "paused",
  paused: "active",
};

export function AgreementStatusButton({
  agreementId,
  currentStatus,
}: {
  agreementId: number;
  currentStatus: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = NEXT[currentStatus];
  const canCancel = currentStatus === "active" || currentStatus === "paused";

  function set(status: string) {
    setError(null);
    const fd = new FormData();
    fd.set("agreement_id", String(agreementId));
    fd.set("status", status);
    startTransition(async () => {
      const res = await updateAgreementStatus(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <span className="flex items-center gap-2">
      {next ? (
        <button
          type="button"
          onClick={() => set(next)}
          disabled={isPending}
          className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
        >
          {isPending ? "…" : `→ ${next}`}
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          onClick={() => {
            if (confirm("Cancel this agreement? This is reversible (set back to active).")) set("canceled");
          }}
          disabled={isPending}
          className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Cancel
        </button>
      ) : null}
      {currentStatus === "canceled" ? (
        <button
          type="button"
          onClick={() => set("active")}
          disabled={isPending}
          className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
        >
          Reactivate
        </button>
      ) : null}
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
