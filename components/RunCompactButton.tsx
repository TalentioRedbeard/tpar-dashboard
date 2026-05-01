// Manual trigger for the dev-log compaction. Admin-only (server action gates).
// Optional date input — empty = "yesterday Chicago" (cron default).

"use client";

import { useState, useTransition } from "react";
import { runCompactNow } from "../lib/dev-log-actions";

export function RunCompactButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ date_chi: string; log_count: number } | null>(null);
  const [dateInput, setDateInput] = useState("");

  function onClick() {
    setError(null);
    setResult(null);
    const fd = new FormData();
    if (dateInput.trim()) fd.set("date_chi", dateInput.trim());
    startTransition(async () => {
      const res = await runCompactNow(fd);
      if (res.ok) {
        setResult({ date_chi: res.date_chi, log_count: res.log_count });
        // Wait a tick for revalidation, then nudge the user to refresh
        setTimeout(() => window.location.reload(), 800);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-3">
      <span className="text-sm font-medium text-neutral-700">Manual run:</span>
      <input
        type="text"
        value={dateInput}
        onChange={(e) => setDateInput(e.target.value)}
        placeholder="YYYY-MM-DD (blank = yesterday)"
        disabled={isPending}
        className="w-48 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {isPending ? "Compacting…" : "Run compact"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
      {result ? (
        <span className="text-xs text-emerald-700">
          OK — {result.date_chi} ({result.log_count} log rows). Reloading…
        </span>
      ) : null}
    </div>
  );
}
