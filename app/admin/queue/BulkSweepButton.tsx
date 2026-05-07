"use client";

import { useState, useTransition } from "react";
import { bulkSweepLowImportance, type BulkResult } from "./actions";

export function BulkSweepButton({ disabled, eligibleCount }: { disabled: boolean; eligibleCount: number }) {
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirm(`Sweep ${eligibleCount} low-importance items older than 7 days? This acks them as 'bulk_swept'.`)) return;
          const fd = new FormData();
          fd.set("max_importance", "6");
          fd.set("older_than_days", "7");
          startTransition(async () => {
            const r = await bulkSweepLowImportance(fd);
            setResult(r);
          });
        }}
      >
        <button
          type="submit"
          disabled={disabled || pending || eligibleCount === 0}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Sweeping…" : `Sweep ${eligibleCount} low-importance (≤6, age >7d)`}
        </button>
      </form>
      {result && (
        <span className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}
