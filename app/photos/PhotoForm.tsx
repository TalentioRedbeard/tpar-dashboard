"use client";

import { useState, useTransition } from "react";
import { uploadJobMedia, type RecentJobOption } from "./actions";

export function PhotoForm({
  canWrite,
  recentJobs,
  defaultJobId,
  clockedJobId,
}: {
  canWrite: boolean;
  recentJobs: RecentJobOption[];
  defaultJobId: string;
  clockedJobId: string | null;
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [hcpJobId, setHcpJobId] = useState(defaultJobId);
  const [primarySubject, setPrimarySubject] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ photo_id: number; photo_url: string; job_id: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canWrite) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
        Read-only — photos can be uploaded by Danny or a tech.
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6">
          <div className="text-lg font-semibold text-emerald-900">Photo added.</div>
          <div className="mt-2 text-sm text-emerald-900">
            Saved as photo #{success.photo_id} on job <code className="font-mono text-xs">{success.job_id.slice(0, 16)}…</code>
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            <a href={success.photo_url} target="_blank" rel="noopener" className="text-emerald-700 hover:underline">View photo →</a>
            <a href={`/job/${success.job_id}`} className="text-emerald-700 hover:underline">Go to job →</a>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSuccess(null); setPhoto(null); setPhotoPreview(null);
              setPrimarySubject(""); setNotes("");
              // keep job + jobId for next photo on same job
            }}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Add another
          </button>
          <a
            href="/"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Done — back home
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!photo) { setError("Snap or pick a photo first."); return; }
        if (!hcpJobId) { setError("Pick a job for this photo."); return; }
        const fd = new FormData();
        fd.set("photo", photo);
        fd.set("hcp_job_id", hcpJobId);
        fd.set("primary_subject", primarySubject);
        fd.set("notes", notes);
        startTransition(async () => {
          const res = await uploadJobMedia(fd);
          if (res.ok) setSuccess({ photo_id: res.photo_id, photo_url: res.photo_url, job_id: hcpJobId });
          else setError(res.error);
        });
      }}
    >
      <section>
        <label className="mb-2 block text-sm font-medium text-neutral-700">Photo *</label>
        <input
          type="file"
          accept="image/*,video/*"
          capture="environment"
          required
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setPhoto(f);
            if (f && f.type.startsWith("image/")) {
              const reader = new FileReader();
              reader.onload = () => setPhotoPreview(reader.result as string);
              reader.readAsDataURL(f);
            } else {
              setPhotoPreview(null);
            }
          }}
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
        />
        {photoPreview ? (
          <img src={photoPreview} alt="preview" className="mt-3 max-h-64 rounded-2xl border border-neutral-200 object-contain" />
        ) : null}
      </section>

      <section>
        <label className="mb-1 block text-sm font-medium text-neutral-700">For job *</label>
        <select
          value={hcpJobId}
          onChange={(e) => setHcpJobId(e.target.value)}
          required
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">— pick a job —</option>
          {recentJobs.map((j) => {
            const isClocked = j.hcp_job_id === clockedJobId;
            return (
              <option key={j.hcp_job_id} value={j.hcp_job_id}>
                {isClocked ? "📍 " : ""}{j.customer_name ?? "(no name)"} — {j.job_date ?? "no date"}
              </option>
            );
          })}
        </select>
        {clockedJobId ? (
          <p className="mt-1 text-xs text-emerald-700">📍 = the job you&apos;re currently clocked into.</p>
        ) : null}
      </section>

      <section>
        <label className="mb-1 block text-sm font-medium text-neutral-700">Subject (optional)</label>
        <input
          type="text"
          value={primarySubject}
          onChange={(e) => setPrimarySubject(e.target.value)}
          placeholder='e.g., "water heater", "drain access", "completed work"'
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </section>

      <section>
        <label className="mb-1 block text-sm font-medium text-neutral-700">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything worth recording about this photo"
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !photo || !hcpJobId}
          className="rounded-md bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {isPending ? "Uploading…" : "Add photo"}
        </button>
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
