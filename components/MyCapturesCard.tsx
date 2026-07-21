"use client";

// "My Captures" — the tech-facing home for recordings they made (Danny 2026-07-21).
// Fixes "I recorded it and can't find it anywhere": every recent capture, playable,
// with one-tap actions to turn it into an estimate or re-file it onto a job.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecordingPlayer } from "./RecordingPlayer";
import { refileCapture } from "../lib/recordings";
import type { MyCapture } from "../lib/capture-types";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" });
}

export function MyCapturesCard({ captures }: { captures: MyCapture[] }) {
  if (!captures || captures.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-base font-semibold text-neutral-800">🎙 My captures</h2>
      <p className="mb-3 text-sm text-neutral-500">Voice notes you recorded — play them, turn one into an estimate, or file it to a job.</p>
      <ul className="space-y-2">
        {captures.map((c) => <CaptureRow key={c.id} c={c} />)}
      </ul>
    </section>
  );
}

function CaptureRow({ c }: { c: MyCapture }) {
  const router = useRouter();
  const [attaching, setAttaching] = useState(false);
  const [job, setJob] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const transcribing = !c.transcript && c.transcript_status !== "blank";

  function attach() {
    setErr(null);
    start(async () => {
      const r = await refileCapture(c.id, { targetKind: "job", targetRef: job });
      if (!r.ok) setErr(r.error);
      else { setDone("Filed to job ✓"); setAttaching(false); router.refresh(); }
    });
  }

  return (
    <li className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700">{c.filedLabel}</span>
        <span>{when(c.created_at)}</span>
        {c.duration_ms ? <><span>·</span><span>{Math.round(c.duration_ms / 1000)}s</span></> : null}
        {c.label ? <><span>·</span><span className="font-medium text-neutral-700">{c.label}</span></> : null}
        <span className="ml-auto"><RecordingPlayer id={c.id} /></span>
      </div>

      {c.transcript ? (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-neutral-800">{c.transcript}</p>
      ) : transcribing ? (
        <p className="mt-1 text-sm italic text-neutral-400">Transcribing… (the audio is safe — text lands shortly)</p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {c.customer_id ? (
          <Link href={`/estimate/new?customer=${encodeURIComponent(c.customer_id)}`}
            className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800">
            Build estimate →
          </Link>
        ) : null}
        {c.target_kind === "job" && c.target_ref ? (
          <Link href={`/job/${c.target_ref}`}
            className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800">
            Open job →
          </Link>
        ) : null}
        {!attaching ? (
          <button type="button" onClick={() => { setAttaching(true); setDone(null); }}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100">
            Attach to a job
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <input value={job} onChange={(e) => setJob(e.target.value)} placeholder="job # or invoice"
              className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
            <button type="button" disabled={pending || !job.trim()} onClick={attach}
              className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              {pending ? "…" : "File it"}
            </button>
            <button type="button" onClick={() => { setAttaching(false); setErr(null); }} className="text-xs text-neutral-500 hover:underline">cancel</button>
          </span>
        )}
        {done ? <span className="text-xs font-medium text-emerald-700">{done}</span> : null}
        {err ? <span className="text-xs text-red-700">{err}</span> : null}
      </div>
    </li>
  );
}
