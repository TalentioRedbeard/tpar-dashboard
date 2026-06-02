"use client";

// #29 v2 owner trigger for the line-item pricebook classification backfill.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runLineItemClassification } from "../lib/classify-actions";

export function RunClassificationButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setErr(null);
      const r = await runLineItemClassification();
      if (!r.ok) { setErr(r.error ?? "failed"); return; }
      const done = r.note === "done";
      setMsg(`embedded ${(r.pb_embedded ?? 0) + (r.line_embedded ?? 0)} · classified ${r.classified ?? 0}${done ? " · ✓ done" : " · run again to finish"}`);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={pending} className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50">
        {pending ? "Classifying…" : "⚙ Run line-item classification"}
      </button>
      {msg ? <span className="text-xs text-green-700">{msg}</span> : null}
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </div>
  );
}
