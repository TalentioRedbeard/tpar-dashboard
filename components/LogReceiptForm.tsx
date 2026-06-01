"use client";

// Per-job "Log a receipt" — inserts a receipts_master row keyed to this job's
// invoice (so it flows into job_cost_v1/v2). Opens an inline form; refreshes the
// job page on save so the running total + breakdown update.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logReceipt } from "../lib/job-cost-actions";

export function LogReceiptForm({ invoiceNumber, jobId }: { invoiceNumber: string; jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
      >
        + Log a receipt
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("invoice_number", invoiceNumber);
        fd.set("job_id", jobId);
        start(async () => {
          const r = await logReceipt(fd);
          if (!r.ok) { setErr(r.error); return; }
          setErr(null);
          setOpen(false);
          router.refresh();
        });
      }}
      className="flex flex-wrap items-end gap-2 rounded-2xl border border-neutral-200 bg-white p-3"
    >
      <label className="text-xs text-neutral-600">
        Amount
        <input name="amount" type="number" step="0.01" min="0" required
          className="mt-0.5 block w-28 rounded-md border border-neutral-300 px-2 py-1 text-sm" placeholder="0.00" />
      </label>
      <label className="min-w-[12rem] flex-1 text-xs text-neutral-600">
        Vendor / description
        <input name="vendor_description" type="text" required
          className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm" placeholder="e.g. Locke Supply — fittings" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => { setOpen(false); setErr(null); }}
        className="text-xs text-neutral-500 hover:underline">Cancel</button>
      {err ? <span className="w-full text-xs text-red-600">⚠ {err}</span> : null}
    </form>
  );
}
