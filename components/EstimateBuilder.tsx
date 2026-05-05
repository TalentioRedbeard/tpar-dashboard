// Multi-option estimate builder for /job/[id]/estimate/new.
// Mirrors the /estimate-draft Slack flow: N options × N line items each,
// pushes to HCP via create-estimate-direct on submit.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEstimateForJob, sendEstimateToClient, generateLineDescription } from "../lib/estimate-actions";

type LineItem = {
  name: string;
  description: string;
  quantity: string;
  unit_price: string;
  unit_cost: string;
};

// Rank is the optional good/better/best designation displayed alongside the
// descriptive option name. "" = unranked. Options should be NAMED
// descriptively (e.g. "Hydrostatic Slab Test"); the rank is decoration the
// tech can opt out of (Danny 2026-05-05).
export type OptionRank = "" | "good" | "better" | "best";

export type Option = {
  name: string;
  rank: OptionRank;
  line_items: LineItem[];
};

const blankLine = (): LineItem => ({ name: "", description: "", quantity: "1", unit_price: "", unit_cost: "" });
const blankOption = (idx: number): Option => ({ name: `Option ${idx + 1}`, rank: "", line_items: [blankLine()] });

// Combine the descriptive name + rank into the string we send to HCP. HCP
// stores the option name as a single plain-text string; rank lives in
// parentheses there. UI keeps them separate for editability + italic
// rendering of the rank.
function combinedHcpOptionName(o: Option): string {
  const base = (o.name ?? "").trim() || "Option";
  return o.rank ? `${base} (${o.rank})` : base;
}

export function EstimateBuilder({
  hcpJobId,
  customerName,
  defaultProjectName,
  initialOptions,
  initialNote,
  basedOnBanner,
}: {
  hcpJobId: string;
  customerName: string;
  defaultProjectName: string;
  initialOptions?: Option[];
  initialNote?: string;
  basedOnBanner?: { voiceNoteId: string; sourceSummary: string; model: string; scope?: string; hcpJobIdForRegen?: string };
}) {
  const [options, setOptions] = useState<Option[]>(
    initialOptions && initialOptions.length > 0
      ? initialOptions.map((o) => ({ ...o, rank: (o.rank ?? "") as OptionRank }))
      : [blankOption(0)],
  );
  const [note, setNote] = useState(initialNote ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ estimate_id: string; estimate_number: string; hcp_url: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Per-option push state — when the tech pushes a single option (Phase 1,
  // for example), we record the resulting HCP estimate per option index so
  // they can keep editing other options and push them as separate estimates
  // later. The main "Push all" submit goes through the existing path.
  type PerOptionPush = { estimate_id: string; estimate_number: string; hcp_url: string | null };
  const [pushedOptions, setPushedOptions] = useState<Record<number, PerOptionPush>>({});
  const [pushingOptionIdx, setPushingOptionIdx] = useState<number | null>(null);
  const [perOptionError, setPerOptionError] = useState<Record<number, string>>({});

  function handlePushSingleOption(optIdx: number, formEl: HTMLFormElement) {
    setPerOptionError((prev) => ({ ...prev, [optIdx]: "" }));
    const fd = new FormData(formEl);
    fd.set("option_indices", String(optIdx));
    setPushingOptionIdx(optIdx);
    startTransition(async () => {
      const res = await createEstimateForJob(fd);
      setPushingOptionIdx(null);
      if (res.ok) {
        setPushedOptions((prev) => ({
          ...prev,
          [optIdx]: { estimate_id: res.estimate_id, estimate_number: res.estimate_number, hcp_url: res.hcp_url },
        }));
      } else {
        setPerOptionError((prev) => ({ ...prev, [optIdx]: res.error }));
      }
    });
  }

  // Send-to-client state — separate from create state so the success card
  // can show both "pushed" and "sent" independently.
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sendMessage, setSendMessage] = useState("");

  function handleSendToClient(estimateId: string) {
    setSendState("sending");
    setSendError(null);
    const fd = new FormData();
    fd.set("estimate_id", estimateId);
    if (sendMessage.trim()) fd.set("message", sendMessage.trim());
    startTransition(async () => {
      const res = await sendEstimateToClient(fd);
      if (res.ok) {
        setSentAt(res.sent_at);
        setSendState("sent");
      } else {
        setSendError(res.error);
        setSendState("error");
      }
    });
  }

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
    setOptions((prev) => [...prev, blankOption(prev.length)]);
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

  // Per-line "generate description" state. Tracked as `${optIdx}-${lineIdx}` keys
  // so multiple lines can request in parallel without collision.
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [generateError, setGenerateError] = useState<Record<string, string | null>>({});

  async function handleGenerateDescription(optIdx: number, lineIdx: number) {
    const li = options[optIdx]?.line_items[lineIdx];
    if (!li) return;
    // Use the existing description as the scope hint if present; else line name.
    const scope = (li.description?.trim() || li.name?.trim() || "").trim();
    if (!scope) {
      setGenerateError((prev) => ({ ...prev, [`${optIdx}-${lineIdx}`]: "Add a line name or rough description first." }));
      return;
    }
    const key = `${optIdx}-${lineIdx}`;
    setGenerating((prev) => ({ ...prev, [key]: true }));
    setGenerateError((prev) => ({ ...prev, [key]: null }));
    const fd = new FormData();
    fd.set("scope", scope);
    if (li.name) fd.set("line_item_name", li.name);
    const res = await generateLineDescription(fd);
    setGenerating((prev) => ({ ...prev, [key]: false }));
    if (res.ok) {
      setLineField(optIdx, lineIdx, "description", res.description);
    } else {
      setGenerateError((prev) => ({ ...prev, [key]: res.error }));
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createEstimateForJob(fd);
      if (res.ok) {
        setResult({ estimate_id: res.estimate_id, estimate_number: res.estimate_number, hcp_url: res.hcp_url });
        // Stay on the page so they can see the success + click through to HCP
      } else {
        setError(res.error);
      }
    });
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="text-lg font-semibold text-emerald-900">Estimate {result.estimate_number} pushed to HCP</h2>
          <p className="mt-1 text-sm text-emerald-800">Customer: {customerName}</p>
          <div className="mt-4 flex flex-wrap gap-2">
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
              onClick={() => { setResult(null); setSendState("idle"); setSendError(null); setSentAt(null); setSendMessage(""); setOptions([blankOption(0)]); setNote(""); setMessage(""); }}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Build another
            </button>
          </div>
        </div>

        {/* Send to client — separate card, only shown after the push succeeded */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h3 className="text-base font-semibold text-neutral-900">Send to client</h3>
          <p className="mt-1 text-sm text-neutral-600">
            Email the estimate to the customer via HCP. Optional: add a personal message shown above the line items.
          </p>
          {sendState !== "sent" ? (
            <>
              <textarea
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Hi! Here's the estimate we discussed. Let me know if you have any questions."
                disabled={sendState === "sending"}
                className="mt-3 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSendToClient(result.estimate_id)}
                  disabled={sendState === "sending"}
                  className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                >
                  {sendState === "sending" ? "Sending…" : "Send estimate to customer"}
                </button>
                {sendState === "error" && sendError ? (
                  <span className="text-sm text-red-700">{sendError}</span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✓ Sent to customer{sentAt ? ` at ${new Date(sentAt).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}` : ""}.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="hcp_job_id" value={hcpJobId} />

      {basedOnBanner ? (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm">
          <div className="flex flex-wrap items-start gap-3">
            <span aria-hidden className="text-lg">✨</span>
            <div className="flex-1 min-w-[240px]">
              <div className="font-semibold text-brand-900">Pre-populated from a voice note</div>
              <div className="mt-0.5 text-xs text-brand-800">
                Reference: {basedOnBanner.sourceSummary} · Model: {basedOnBanner.model}
              </div>
              <div className="mt-1 text-xs text-brand-700">
                Review carefully — confidence on per-line reasoning was below 1.0. Edit anything before pushing.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/voice-notes/${basedOnBanner.voiceNoteId}`}
                className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100"
              >
                Open voice note
              </a>
              <RegenerateButton
                voiceNoteId={basedOnBanner.voiceNoteId}
                scope={basedOnBanner.scope ?? "full_option_set"}
                hcpJobId={basedOnBanner.hcpJobIdForRegen ?? hcpJobId}
                disabled={isPending}
              />
            </div>
          </div>
        </div>
      ) : null}

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
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {/* Hidden field — combined "Name (rank)" — what HCP sees */}
            <input type="hidden" name={`options[${optIdx}][name]`} value={combinedHcpOptionName(opt)} />

            {/* Descriptive name (visible, editable) */}
            <input
              type="text"
              value={opt.name}
              onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === optIdx ? { ...o, name: e.target.value } : o)))}
              className="min-w-[220px] flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-semibold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder={`Descriptive option name (e.g. "Hydrostatic Slab Test")`}
              disabled={isPending}
            />

            {/* Rank picker (italic display) — empty = unranked */}
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-neutral-500">Rank</span>
              <select
                value={opt.rank}
                onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === optIdx ? { ...o, rank: e.target.value as OptionRank } : o)))}
                disabled={isPending}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs italic focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                title="Optional good/better/best designation. Leave unranked for sequential phases or alternatives that aren't strictly better-than."
              >
                <option value="">unranked</option>
                <option value="good">good</option>
                <option value="better">better</option>
                <option value="best">best</option>
              </select>
            </label>

            <span className="text-xs text-neutral-500">
              Total: <span className="font-medium text-neutral-700">${totalForOption(opt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => addLine(optIdx)} disabled={isPending} className="text-xs text-neutral-700 underline hover:text-neutral-900">+ line</button>
              {options.length > 1 ? (
                <button type="button" onClick={() => removeOption(optIdx)} disabled={isPending} className="text-xs text-red-700 hover:text-red-900">remove option</button>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  const formEl = (e.currentTarget.closest("form") as HTMLFormElement | null);
                  if (formEl) handlePushSingleOption(optIdx, formEl);
                }}
                disabled={isPending || opt.line_items.filter((li) => li.name && Number(li.unit_price) > 0).length === 0}
                title="Pushes just this option as a separate HCP estimate"
                className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {pushingOptionIdx === optIdx ? "Pushing…" : "Push this option →"}
              </button>
            </span>
          </div>

          {pushedOptions[optIdx] ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs">
              <span className="font-semibold text-emerald-900">✓ Pushed as estimate {pushedOptions[optIdx].estimate_number}</span>
              {pushedOptions[optIdx].hcp_url ? (
                <a
                  href={pushedOptions[optIdx].hcp_url!}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-white px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                >
                  Open in HCP →
                </a>
              ) : null}
              <span className="text-emerald-700">— edit + push again to create another estimate.</span>
            </div>
          ) : null}
          {perOptionError[optIdx] ? (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">{perOptionError[optIdx]}</div>
          ) : null}

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
              <div className="col-span-12">
                <textarea
                  name={`options[${optIdx}][line_items][${lineIdx}][description]`}
                  value={li.description}
                  onChange={(e) => setLineField(optIdx, lineIdx, "description", e.target.value)}
                  placeholder="Description (multi-line OK; visible to customer). Click ✨ Generate to draft from line name + rough notes."
                  rows={2}
                  disabled={isPending}
                  className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerateDescription(optIdx, lineIdx)}
                    disabled={isPending || generating[`${optIdx}-${lineIdx}`]}
                    className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Generate a customer-facing description in Danny's voice using Claude Haiku."
                  >
                    {generating[`${optIdx}-${lineIdx}`] ? "Generating…" : "✨ Generate description"}
                  </button>
                  {generateError[`${optIdx}-${lineIdx}`] ? (
                    <span className="text-xs text-red-700">{generateError[`${optIdx}-${lineIdx}`]}</span>
                  ) : null}
                </div>
              </div>
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

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
          {isPending && pushingOptionIdx === null ? "Pushing all to HCP…" : "Push ALL options as one HCP estimate →"}
        </button>
        <button type="button" onClick={() => router.back()} disabled={isPending} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
          Cancel
        </button>
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
        <span className="text-xs text-neutral-500">
          Or push individual options (above) to stage them as separate HCP estimates — useful for diagnostic/phased work.
        </span>
      </div>
    </form>
  );
}

// Small inline panel for regenerating from the same voice note. Lets the
// tech change scope or pass extra instructions before navigating to a
// fresh server-render of the from-voice-note page (which re-runs the
// generator). Confirms first because it replaces the in-progress draft.
function RegenerateButton({
  voiceNoteId,
  scope: initialScope,
  hcpJobId,
  disabled,
}: {
  voiceNoteId: string;
  scope: string;
  hcpJobId: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>(initialScope);
  const [extra, setExtra] = useState<string>("");
  const router = useRouter();

  function go() {
    if (!confirm("Regenerate will replace your current draft with a fresh generator output. You'll lose any edits. Continue?")) return;
    const params = new URLSearchParams();
    params.set("note", voiceNoteId);
    params.set("scope", scope);
    if (extra.trim()) params.set("extra", extra.trim());
    // Bust any router cache by appending a salt
    params.set("_", String(Date.now()));
    router.push(`/job/${hcpJobId}/estimate/from-voice-note?${params.toString()}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100 disabled:opacity-50"
        title="Run the generator again — generator output is non-deterministic"
      >
        ↻ Regenerate
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-brand-300 bg-white p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-brand-900">Regenerate from voice note</span>
        <button type="button" onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-800">×</button>
      </div>
      <div className="mb-2">
        <div className="mb-1 font-medium text-neutral-700">Target scope</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {[
            { v: "single_line_item", label: "Single line item" },
            { v: "full_option_set", label: "Full option set" },
            { v: "add_to_option", label: "Add to existing option" },
          ].map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setScope(opt.v)}
              className={`rounded-md border px-2 py-1.5 ${scope === opt.v ? "border-brand-400 bg-brand-50 text-brand-900" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2">
        <div className="mb-1 font-medium text-neutral-700">Extra instructions (optional)</div>
        <textarea
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          rows={2}
          placeholder='e.g. "make the phases cheaper" or "keep options unranked" or "add a line for sediment trap"'
          className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={go}
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800"
        >
          ↻ Generate fresh draft
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
        <span className="text-[10px] text-neutral-500">Replaces your current draft.</span>
      </div>
    </div>
  );
}
