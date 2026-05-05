"use client";

// Generator form — pick scope + extra instructions, fire generator, show result.
// First-cut UI: render the JSON output formatted; "copy into estimate builder"
// integration is a follow-up.

import { useState, useTransition } from "react";
import { generateFromReference } from "../actions";

type Props = {
  voiceNoteId: string;
  hcpJobId?: string;
  hcpCustomerId?: string;
};

type Scope = "single_line_item" | "full_option_set" | "add_to_option";

export function GenerateForm({ voiceNoteId, hcpJobId, hcpCustomerId }: Props) {
  const [scope, setScope] = useState<Scope>("single_line_item");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [existingOptionSummary, setExistingOptionSummary] = useState("");
  const [output, setOutput] = useState<any>(null);
  const [meta, setMeta] = useState<{ model: string; source_summary: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    setOutput(null);
    setMeta(null);
    startTransition(async () => {
      const res = await generateFromReference({
        reference_type: "voice_note",
        reference_id: voiceNoteId,
        hcp_job_id: hcpJobId,
        hcp_customer_id: hcpCustomerId,
        target_scope: scope,
        existing_option_summary: scope === "add_to_option" ? existingOptionSummary || undefined : undefined,
        extra_instructions: extraInstructions || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOutput(res.output);
      setMeta({ model: res.model, source_summary: res.source_summary });
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Target scope</label>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setScope("single_line_item")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${scope === "single_line_item" ? "border-brand-400 bg-brand-50 text-brand-900" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}
          >
            Single line item
          </button>
          <button
            type="button"
            onClick={() => setScope("full_option_set")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${scope === "full_option_set" ? "border-brand-400 bg-brand-50 text-brand-900" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}
          >
            Full option set (Good / Better / Best)
          </button>
          <button
            type="button"
            onClick={() => setScope("add_to_option")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${scope === "add_to_option" ? "border-brand-400 bg-brand-50 text-brand-900" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}
          >
            Add to existing option
          </button>
        </div>
      </div>

      {scope === "add_to_option" ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Existing option summary</label>
          <textarea
            value={existingOptionSummary}
            onChange={(e) => setExistingOptionSummary(e.target.value)}
            placeholder="Paste a brief description of the option this line will slot into…"
            rows={3}
            className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
      ) : null}

      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Extra instructions <span className="font-normal normal-case text-neutral-400">(optional)</span></label>
        <textarea
          value={extraInstructions}
          onChange={(e) => setExtraInstructions(e.target.value)}
          placeholder={`e.g. "match the format of the $0 Custom Plumbing Service line on this estimate" or "include the after-hours modifier" — anything the voice note didn't cover`}
          rows={3}
          className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {pending ? "Generating… (typically 10-25s)" : "Generate based on this voice note"}
      </button>

      {output ? (
        <div className="space-y-3">
          {meta ? (
            <div className="text-xs text-neutral-500">Model: {meta.model} · Reference: {meta.source_summary}</div>
          ) : null}
          {scope === "full_option_set" && Array.isArray(output?.options) ? (
            <div className="space-y-3">
              {output.options.map((opt: any, i: number) => (
                <OptionCard key={i} option={opt} />
              ))}
            </div>
          ) : output?.line_item ? (
            <LineItemCard item={output.line_item} />
          ) : (
            <pre className="overflow-auto rounded-2xl border border-neutral-200 bg-neutral-900 p-4 text-xs text-neutral-100">{JSON.stringify(output, null, 2)}</pre>
          )}
          <details className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs">
            <summary className="cursor-pointer text-neutral-600">View raw JSON</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-neutral-700">{JSON.stringify(output, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function LineItemCard({ item }: { item: any }) {
  if (!item) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-sm">
      <div className="border-b border-brand-100 bg-brand-50 px-4 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-800">Line item</div>
        <div className="font-semibold text-neutral-900">{item.name ?? "(unnamed)"}</div>
        {item.scope_summary ? <div className="text-xs text-neutral-600">{item.scope_summary}</div> : null}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-xs">
        <div><span className="text-neutral-500">Hours: </span><span className="tabular-nums">{item.hours?.total ?? "—"}</span> <span className="text-neutral-400">(rough_in {item.hours?.rough_in ?? 0} · top_out {item.hours?.top_out ?? 0} · final {item.hours?.final ?? 0})</span></div>
        <div><span className="text-neutral-500">Crew: </span><span className="tabular-nums">{item.crew_size ?? 1}</span> <span className="text-neutral-400">@ {fmtMoney(item.hourly_rate)}/hr</span></div>
        <div><span className="text-neutral-500">Labor: </span><span className="tabular-nums">{fmtMoney(item.labor_cost)}</span></div>
        <div><span className="text-neutral-500">Materials: </span><span className="tabular-nums">{fmtMoney(item.materials_total)}</span> <span className="text-neutral-400">({fmtMoney(item.materials_cost)} × {item.materials_markup ?? 1.3})</span></div>
        <div className="col-span-2"><span className="text-neutral-500">Modifiers: </span>{(item.modifiers ?? []).length > 0 ? (item.modifiers as string[]).map((m, i) => <span key={i} className="ml-1 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700">{m}</span>) : <span className="text-neutral-400">none</span>}</div>
      </div>
      <div className="flex items-baseline justify-between border-t border-neutral-100 bg-neutral-50 px-4 py-3">
        <div className="text-xs text-neutral-500">Subtotal · suggested price</div>
        <div className="font-semibold tabular-nums text-neutral-900">{fmtMoney(item.suggested_price ?? item.subtotal)}</div>
      </div>
      {item.description ? (
        <div className="border-t border-neutral-100 px-4 py-3 text-xs leading-relaxed text-neutral-700">
          <div className="mb-1 font-semibold uppercase tracking-wide text-neutral-500">Work description</div>
          <div className="whitespace-pre-wrap">{item.description}</div>
        </div>
      ) : null}
      {item.reasoning ? (
        <details className="border-t border-neutral-100 bg-amber-50/40 px-4 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-amber-900">Reasoning + confidence ({item.confidence ?? "?"})</summary>
          <p className="mt-1 whitespace-pre-wrap text-amber-900/90">{item.reasoning}</p>
        </details>
      ) : null}
    </div>
  );
}

function OptionCard({ option }: { option: any }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Option {option.level ?? "?"}</div>
        <div className="font-semibold text-neutral-900">{option.name ?? "(unnamed)"}</div>
        {option.description ? <div className="mt-0.5 text-xs text-neutral-600">{option.description}</div> : null}
      </div>
      <div className="space-y-3 p-4">
        {(option.line_items ?? []).map((li: any, i: number) => <LineItemCard key={i} item={li} />)}
      </div>
    </div>
  );
}
