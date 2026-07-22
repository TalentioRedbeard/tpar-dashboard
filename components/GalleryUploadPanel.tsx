"use client";

// Upload/take-a-photo panel for the job gallery (Danny 2026-07-22 — Anthony hit a
// dead end: "Photos" opened a view-only gallery with no way to add his photo). A
// prominent "📷 Take or add a photo" button on the job's gallery expands the proven
// PhotoForm (camera-capable: <input accept="image/*" capture="environment">),
// pre-scoped to THIS job. Reuses the /photos upload pipeline wholesale.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoForm } from "../app/photos/PhotoForm";
import type { RecentJobOption } from "../app/photos/actions";

export function GalleryUploadPanel({
  canWrite, recentJobs, defaultJobId, clockedJobId,
}: {
  canWrite: boolean;
  recentJobs: RecentJobOption[];
  defaultJobId: string;
  clockedJobId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-5 rounded-2xl border border-brand-200 bg-brand-50/50 p-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          📷 Take or add a photo
        </button>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-900">Add a photo to this job</span>
            <button type="button" onClick={() => { setOpen(false); router.refresh(); }} className="text-xs text-neutral-500 hover:text-neutral-800">close ×</button>
          </div>
          <PhotoForm canWrite={canWrite} recentJobs={recentJobs} defaultJobId={defaultJobId} clockedJobId={clockedJobId} />
        </div>
      )}
    </div>
  );
}
