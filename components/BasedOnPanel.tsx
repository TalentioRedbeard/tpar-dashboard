"use client";

// "Based On…" panel for the multi-option estimate builder. Lets the operator
// seed a draft from a mix of existing context (internal notes, voice-note
// transcripts, selected comms, customer 360, and a job's 360), then hands the
// generated options back to the builder via onApply for review/adjust/push.
// Photos/vision are a fast-follow.

import { useState, useTransition } from "react";
import {
  fetchBasedOnSources,
  generateBasedOnEstimate,
  createBasedOnPhotoUpload,
  finalizeBasedOnPhoto,
  type BasedOnSources,
  type BasedOnDraftOption,
} from "@/lib/based-on-actions";
import { browserClient } from "@/lib/supabase-browser";

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-md border px-2 py-1 text-left text-xs ${active ? "border-brand-400 bg-brand-50 text-brand-900" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}>
      {children}
    </button>
  );
}

export function BasedOnPanel({
  hcpCustomerId,
  onApply,
  disabled,
}: {
  hcpCustomerId: string;
  onApply: (options: BasedOnDraftOption[], note: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<BasedOnSources | null>(null);
  const [loadingSources, startLoad] = useTransition();

  const [freeform, setFreeform] = useState("");
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set());
  const [voiceIds, setVoiceIds] = useState<Set<string>>(new Set());
  const [commIds, setCommIds] = useState<Set<number>>(new Set());
  const [inc360, setInc360] = useState(false);
  const [jobId, setJobId] = useState("");
  const [incJob360, setIncJob360] = useState(false);
  const [photoIds, setPhotoIds] = useState<Set<number>>(new Set());
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openPanel() {
    setOpen(true);
    if (sources === null && !loadingSources) {
      startLoad(async () => { setSources(await fetchBasedOnSources(hcpCustomerId)); });
    }
  }

  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const urls: string[] = [];
    const supa = browserClient();
    for (const f of Array.from(files).slice(0, 8)) {
      const slot = await createBasedOnPhotoUpload({ mime: f.type });
      if (!slot.ok) continue;
      const { error: upErr } = await supa.storage
        .from("job-photos")
        .uploadToSignedUrl(slot.path, slot.token, f, { contentType: f.type || "image/jpeg" });
      if (upErr) continue;
      const fin = await finalizeBasedOnPhoto({ path: slot.path });
      if (fin.ok) urls.push(fin.url);
    }
    setUploadedPhotos((cur) => [...cur, ...urls].slice(0, 8));
    setUploading(false);
  }

  const anySelected = freeform.trim().length > 0 || noteIds.size > 0 || voiceIds.size > 0 || commIds.size > 0 || inc360 || (incJob360 && !!jobId) || photoIds.size > 0 || uploadedPhotos.length > 0;

  function generate() {
    if (generating || !anySelected) return;
    setErr(null);
    setGenerating(true);
    generateBasedOnEstimate(hcpCustomerId, {
      freeform: freeform.trim() || undefined,
      noteIds: [...noteIds],
      voiceNoteIds: [...voiceIds],
      commIds: [...commIds],
      includeCustomer360: inc360,
      jobId: jobId || undefined,
      includeJob360: incJob360,
      photoIds: [...photoIds],
      uploadedImageUrls: uploadedPhotos,
    }).then((res) => {
      setGenerating(false);
      if (res.ok) { onApply(res.options, res.note); setOpen(false); }
      else setErr(res.error);
    }).catch((e) => { setGenerating(false); setErr(e instanceof Error ? e.message : String(e)); });
  }

  if (!open) {
    return (
      <button type="button" onClick={openPanel} disabled={disabled}
        className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50"
        title="Seed this estimate from notes, voice notes, comms, and the customer/job 360 — Claude drafts the options for you to review.">
        ✨ Based on…
      </button>
    );
  }

  const ckbox = "h-3.5 w-3.5 rounded border-neutral-300";

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-brand-900">✨ Based on… <span className="font-normal text-brand-700">— pick any context; Claude drafts the options</span></div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-800">close</button>
      </div>

      {loadingSources ? <div className="text-xs text-neutral-500">Loading this customer&apos;s context…</div> : null}

      <div className="space-y-3">
        {/* Freeform */}
        <div>
          <div className="mb-1 text-xs font-medium text-neutral-600">✍️ Freeform context (type or dictate)</div>
          <textarea value={freeform} onChange={(e) => setFreeform(e.target.value)} rows={2}
            placeholder="e.g. Cast-iron stack failed at the basement transition; customer wants it gone for good, open to phasing…"
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>

        {/* Customer 360 */}
        {sources?.hasCustomer360 ? (
          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input type="checkbox" className={ckbox} checked={inc360} onChange={() => setInc360((v) => !v)} />
            👤 Include customer 360 (history, past work, lifetime value)
          </label>
        ) : null}

        {/* Notes */}
        {sources && sources.notes.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-600">📝 Internal notes ({sources.notes.length})</div>
            <div className="grid max-h-32 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {sources.notes.map((n) => (
                <label key={n.id} className="flex items-start gap-1.5 rounded border border-neutral-100 bg-white px-2 py-1 text-xs">
                  <input type="checkbox" className={`${ckbox} mt-0.5`} checked={noteIds.has(n.id)} onChange={() => toggle(noteIds, n.id, setNoteIds)} />
                  <span className="text-neutral-700"><span className="text-neutral-400">{n.date} · {n.kind}</span> — {n.snippet}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* Voice notes */}
        {sources && sources.voiceNotes.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-600">🎙️ Voice notes ({sources.voiceNotes.length})</div>
            <div className="grid max-h-32 grid-cols-1 gap-1 overflow-y-auto">
              {sources.voiceNotes.map((v) => (
                <label key={v.id} className="flex items-start gap-1.5 rounded border border-neutral-100 bg-white px-2 py-1 text-xs">
                  <input type="checkbox" className={`${ckbox} mt-0.5`} checked={voiceIds.has(v.id)} onChange={() => toggle(voiceIds, v.id, setVoiceIds)} />
                  <span className="text-neutral-700"><span className="text-neutral-400">{v.date} · {v.tech}</span> — {v.snippet}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* Comms */}
        {sources && sources.comms.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-600">💬 Comms ({sources.comms.length})</div>
            <div className="grid max-h-32 grid-cols-1 gap-1 overflow-y-auto">
              {sources.comms.map((c) => (
                <label key={c.id} className="flex items-start gap-1.5 rounded border border-neutral-100 bg-white px-2 py-1 text-xs">
                  <input type="checkbox" className={`${ckbox} mt-0.5`} checked={commIds.has(c.id)} onChange={() => toggle(commIds, c.id, setCommIds)} />
                  <span className="text-neutral-700"><span className="text-neutral-400">{c.date} · {c.channel}/{c.direction}</span> — {c.snippet}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* Job 360 */}
        {sources && sources.jobs.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-600">📋 Job 360 (optional — pick a job)</div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={jobId} onChange={(e) => { setJobId(e.target.value); setIncJob360(!!e.target.value); }}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs">
                <option value="">— no job —</option>
                {sources.jobs.map((j) => <option key={j.hcp_job_id} value={j.hcp_job_id}>{j.label}</option>)}
              </select>
              {jobId ? (
                <label className="flex items-center gap-1.5 text-xs text-neutral-700">
                  <input type="checkbox" className={ckbox} checked={incJob360} onChange={() => setIncJob360((v) => !v)} />
                  include its 360
                </label>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Photos → Claude reads them (vision) */}
        {sources && sources.photos.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-600">📷 Photos ({sources.photos.length}) — Claude looks at the ones you pick</div>
            <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-5">
              {sources.photos.map((p) => {
                const on = photoIds.has(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggle(photoIds, p.id, setPhotoIds)} title={p.label}
                    className={`relative aspect-square overflow-hidden rounded-md border-2 ${on ? "border-brand-500 ring-2 ring-brand-300" : "border-neutral-200 hover:border-neutral-300"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.label} className="h-full w-full object-cover" loading="lazy" />
                    {on ? <span className="absolute right-0.5 top-0.5 rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Upload photos (F) — new photos for this estimate, read by Claude vision */}
        <div>
          <div className="mb-1 text-xs font-medium text-neutral-600">📤 Add photos{uploading ? " (uploading…)" : ""} — Claude reads what you upload</div>
          <input type="file" accept="image/*" multiple disabled={uploading}
            onChange={(e) => { void handleUpload(e.target.files); e.currentTarget.value = ""; }}
            className="block w-full text-xs text-neutral-600 file:mr-2 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-2 file:py-1 file:text-xs file:font-medium" />
          {uploadedPhotos.length > 0 ? (
            <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {uploadedPhotos.map((u, i) => (
                <div key={u} className="relative aspect-square overflow-hidden rounded-md border-2 border-brand-500 ring-2 ring-brand-300">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="uploaded" className="h-full w-full object-cover" loading="lazy" />
                  <button type="button" onClick={() => setUploadedPhotos((cur) => cur.filter((_, j) => j !== i))}
                    title="remove" className="absolute right-0.5 top-0.5 rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">×</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-brand-200 pt-3">
        <button type="button" onClick={generate} disabled={generating || !anySelected}
          className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
          {generating ? "Drafting…" : "Generate draft from selected →"}
        </button>
        <span className="text-[11px] text-neutral-500">Fills the builder below — review &amp; adjust before pushing. Nothing auto-sends.</span>
        {err ? <span className="text-xs text-red-700">{err}</span> : null}
      </div>
    </div>
  );
}
