// Multi-option estimate builder for /job/[id]/estimate/new.
// Mirrors the /estimate-draft Slack flow: N options × N line items each,
// pushes to HCP via create-estimate-direct on submit.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEstimateForJob } from "../lib/estimate-actions";

type LineItem = {
  name: string;
  description: string;
  quantity: string;
  unit_price: string;
  unit_cost: string;
};

type Option = {
  name: string;
  line_items: LineItem[];
};

const blankLine = (): LineItem => ({ name: "", description: "", quantity: "1", unit_price: "", unit_cost: "" });

export function EstimateBuilder({
  hcpJobId,
  customerName,
  defaultProjectName,
}: {
  hcpJobId: string;
  customerName: string;
  defaultProjectName: string;
}) {
  const [options, setOptions] = useState<Option[]>([
    { name: "Option 1", line_items: [blankLine()] },
  ]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ estimate_number: string; hcp_url: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const totalForOption = (o: Option): number =>
    o.line_items.reduce((n, li) => {
      const q = Number(li.quantity) || 0;
      const p = Number(li.unit_price) || 0;
      return n + q * p;
    }, 0);

  function updateOption(idx: number, mut: (o: Option) => void) {
    setOptions((prev) => {
      const next = prev.map((o, i) => (i === idx ? { ...o, line_items: o.line_items.map((li) => ({ ...li })) } : o));
      mut(next[idx]);
      return next;
    });
  }

  function addOption() {
    setOptions((prev) => [...prev, { name: `Option ${prev.length + 1}`, line_items: [blankLine()] }]);
  }

  function removeOption(idx: number) {
    setOptions((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function addLine(optIdx: number) {
    updateOption(optIdx, (o) => o.line_items.push(blankLine()));
  }

  function removeLine(optIdx: number, lineIdx: number) {
    updateOption(optIdx, (o) => {
      if (o.line_items.length === 1) return;
      o.line_items.splice(lineIdx, 1);
    });
  }

  function setLineField(optIdx: number, lineIdx: number, field: keyof LineItem, value: string) {
    updateOption(optIdx, (o) => { o.line_items[lineIdx][field] = value; });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createEstimateForJob(fd);
      if (res.ok) {
        setResult({ estimate_number: res.estimate_number, hcp_url: res.hcp_url });
        // Stay on the page so they can see the success + click through to HCP
      } else {
        setError(res.error);
      }
    });
  }

  if (result) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">Estimate {result.estimate_number} pushed to HCP</h2>
        <p className="mt-2 text-sm text-emerald-800">Customer: {customerName}</p>
        <div className="mt-4 flex gap-2">
          {result.hcp_url ? (
            <a href={result.hcp_url} target="_blank" rel="noreferrer" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
              Open in HCP
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => router.push(`/job/${hcpJobId}`)}
            className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-100"
          >
            Back to job
          </button>
          <button
            type="button"
            onClick={() => { setResult(null); setOptions([{ name: "Option 1", line_items: [blankLine()] }]); setNote(""); setMessage(""); }}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Build another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="hcp_job_id" value={hcpJobId} />

      {/* Customer/job context (read-only) */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Customer</div>
        <div className="mt-1 font-medium text-neutral-900">{customerName}</div>
        <div className="mt-2 text-xs uppercase tracking-wide text-neutral-500">Default project name</div>
        <div className="mt-1 text-neutral-700">{defaultProjectName}</div>
      </div>

      {/* Options */}
      {options.map((opt, optIdx) => (
        <div key={optIdx} className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-3">
            <input
              type="text"
              name={`options[${optIdx}][name]`}
              value={opt.name}
              onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === optIdx ? { ...o, name: e.target.value } : o)))}
              className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-semibold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder={`Option ${optIdx + 1}`}
              disabled={isPending}
            />
            <span className="text-xs text-neutral-500">
              Total: <span className="font-medium text-neutral-700">${totalForOption(opt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </span>
            <span className="ml-auto flex gap-2">
              <button type="button" onClick={() => addLine(optIdx)} disabled={isPending} className="text-xs text-neutral-700 underline hover:text-neutral-900">+ line</button>
              {options.length > 1 ? (
                <button type="button" onClick={() => removeOption(optIdx)} disabled={isPending} className="text-xs text-red-700 hover:text-red-900">remove option</button>
              ) : null}
            </span>
          </div>

          {opt.line_items.map((li, lineIdx) => (
            <div key={lineIdx} className="mb-2 grid grid-cols-12 gap-2 rounded-md border border-neutral-100 bg-neutral-50 p-2">
              <input
                type="text"
                name={`options[${optIdx}][line_items][${lineIdx}][name]`}
                value={li.name}
                onChange={(e) => setLineField(optIdx, lineIdx, "name", e.target.value)}
                placeholder="Line item name"
                disabled={isPending}
                className="col-span-4 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <input
                type="number"
                name={`options[${optIdx}][line_items][${lineIdx}][quantity]`}
                value={li.quantity}
                onChange={(e) => setLineField(optIdx, lineIdx, "quantity", e.target.value)}
                step="0.01"
                min="0"
                placeholder="Qty"
                disabled={isPending}
                className="col-span-2 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <input
                type="number"
                name={`options[${optIdx}][line_items][${lineIdx}][unit_price]`}
                value={li.unit_price}
                onChange={(e) => setLineField(optIdx, lineIdx, "unit_price", e.target.value)}
                step="0.01"
                min="0"
                placeholder="Unit price ($)"
                disabled={isPending}
                className="col-span-2 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <input
                type="number"
                name={`options[${optIdx}][line_items][${lineIdx}][unit_cost]`}
                value={li.unit_cost}
                onChange={(e) => setLineField(optIdx, lineIdx, "unit_cost", e.target.value)}
                step="0.01"
                min="0"
                placeholder="Unit cost ($) opt"
                disabled={isPending}
                className="col-span-2 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <div className="col-span-2 flex items-center justify-end gap-1 text-xs text-neutral-500">
                <span>${(Number(li.quantity) * Number(li.unit_price) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                {opt.line_items.length > 1 ? (
                  <button type="button" onClick={() => removeLine(optIdx, lineIdx)} disabled={isPending} className="ml-2 text-red-700 hover:text-red-900">×</button>
                ) : null}
              </div>
              <textarea
                name={`options[${optIdx}][line_items][${lineIdx}][description]`}
                value={li.description}
                onChange={(e) => setLineField(optIdx, lineIdx, "description", e.target.value)}
                placeholder="Description (multi-line OK; visible to customer)"
                rows={2}
                disabled={isPending}
                className="col-span-12 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          ))}
        </div>
      ))}

      <button type="button" onClick={addOption} disabled={isPending} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
        + Add option
      </button>

      {/* Optional notes/message */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">Internal note (HCP Pro UI Notes)</span>
          <textarea
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Scope of work / internal context (not customer-facing)"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">Customer-facing message (HCP PDF prose)</span>
          <textarea
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Free-form prose shown to customer above the line items"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
          {isPending ? "Pushing to HCP…" : "Verify + push to HCP"}
        </button>
        <button type="button" onClick={() => router.back()} disabled={isPending} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
          Cancel
        </button>
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
