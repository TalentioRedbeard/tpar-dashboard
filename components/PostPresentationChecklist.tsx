"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getJobChecklistPrefill, submitPostPresentationChecklist } from "@/app/me/checklist-actions";

type Tri = boolean | null;

const RESULTS: ReadonlyArray<readonly [string, string]> = [
  ["performing", "Performing now"],
  ["scheduling", "Scheduling"],
  ["estimate", "Estimate only"],
  ["service_fee", "Service fee only"],
  ["no_answer", "No answer / no decision"],
  ["other", "Other"],
];

export function PostPresentationChecklist({ hcpJobId }: { hcpJobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [photoCount, setPhotoCount] = useState(0);
  const [optionsHint, setOptionsHint] = useState<string | null>(null);
  const [beforePhoto, setBeforePhoto] = useState<Tri>(null);
  const [options, setOptions] = useState<Tri>(null);
  const [result, setResult] = useState("");
  const [other, setOther] = useState("");
  const [optionsNotes, setOptionsNotes] = useState("");

  // Auto-fill from accrued data — confirm, don't re-type.
  useEffect(() => {
    let on = true;
    getJobChecklistPrefill(hcpJobId).then((p) => {
      if (!on) return;
      setPhotoCount(p.post.photoCount);
      setOptionsHint(p.post.optionsHint);
      setBeforePhoto((v) => (v === null ? p.post.beforePhotoTaken : v));
      setOptions((v) => (v === null ? p.post.optionsProvided : v));
    }).catch(() => {});
    return () => { on = false; };
  }, [hcpJobId]);

  if (submitted) {
    return (
      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        ✓ Post-presentation checklist submitted.
      </div>
    );
  }

  const onSubmit = () => start(async () => {
    setErr(null);
    const res = await submitPostPresentationChecklist({
      hcp_job_id: hcpJobId,
      before_photo_taken: beforePhoto,
      options_provided: options,
      options_notes: optionsNotes || null,
      appointment_result: result || null,
      other_description: result === "other" ? other || null : null,
    });
    if (!res.ok) { setErr(res.error); return; }
    setSubmitted(true);
    router.refresh();
  });

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
        Post-presentation checklist
        <span className="rounded bg-amber-200/70 px-1 py-0.5 text-[9px] font-medium text-amber-800">auto-filled</span>
      </div>
      <div className="space-y-2.5 text-xs text-neutral-700">
        <Row label="Before photo taken?" hint={photoCount > 0 ? `📸 ${photoCount} on file` : undefined}>
          <YesNo value={beforePhoto} onChange={setBeforePhoto} />
        </Row>
        <Row label="Options presented?" hint={optionsHint ?? undefined}>
          <YesNo value={options} onChange={setOptions} />
        </Row>
        <div>
          <div className="mb-1 text-neutral-600">Result</div>
          <select
            value={result}
            onChange={(e) => setResult(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">— select —</option>
            {RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {result === "other" ? (
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Describe…"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        ) : null}
        <textarea
          value={optionsNotes}
          onChange={(e) => setOptionsNotes(e.target.value)}
          rows={2}
          placeholder="Options / notes (optional)"
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
        />
      </div>
      {err ? <div className="mt-1 text-xs text-red-700">{err}</div> : null}
      <button
        type="button"
        disabled={pending}
        onClick={onSubmit}
        className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Submit checklist"}
      </button>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>
        {label}
        {hint ? <span className="ml-1 text-[10px] font-medium text-emerald-700">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

function YesNo({ value, onChange }: { value: Tri; onChange: (v: boolean) => void }) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-neutral-300">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-2.5 py-1 text-xs font-medium ${value === true ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
      >Yes</button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`border-l border-neutral-300 px-2.5 py-1 text-xs font-medium ${value === false ? "bg-red-600 text-white" : "bg-white text-neutral-600"}`}
      >No</button>
    </span>
  );
}
