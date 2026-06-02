"use client";

// #31 lazy job-media gallery. Fetches Drive media on demand (not on page render,
// so the job page stays fast), renders thumbnails grouped by day folder with a
// graceful fallback (Drive thumbnails need the viewer's Google session) + an
// always-works "Open Drive folder" link.

import { useState } from "react";
import { getJobMedia, type MediaFolder, type MediaFile } from "../lib/job-media-actions";

export function JobMediaGallery({ invoiceTrunk }: { invoiceTrunk: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setState("loading"); setErr(null);
    const r = await getJobMedia(invoiceTrunk);
    if (!r.ok) { setErr(r.error ?? "failed"); setState("error"); return; }
    setFolders(r.folders ?? []); setState("done");
  };

  if (state === "idle") {
    return (
      <button type="button" onClick={load} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
        📷 Load job media
      </button>
    );
  }
  if (state === "loading") return <div className="text-sm text-neutral-500">Loading media from Drive…</div>;
  if (state === "error") {
    return (
      <div className="text-sm text-red-600">
        {err} · <button type="button" onClick={load} className="underline">retry</button>
      </div>
    );
  }
  if (folders.length === 0) {
    return <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">No media folders are linked to this job yet. Photos submitted via the Slack #job-media flow show up here.</div>;
  }

  return (
    <div className="space-y-5">
      {folders.map((f) => (
        <div key={f.drive_folder_id}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-neutral-800">
              {f.day_number ? `Day ${f.day_number}` : "Media"} · {f.file_count} file{f.file_count === 1 ? "" : "s"}
            </h4>
            <a href={f.drive_web_link} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-700 hover:underline">Open Drive folder →</a>
          </div>
          {f.error ? <div className="mb-2 text-xs text-red-600">Couldn&apos;t list this folder: {f.error}</div> : null}
          {f.files.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {f.files.map((file) => <MediaTile key={file.id} file={file} />)}
            </div>
          ) : !f.error ? (
            <div className="text-xs text-neutral-500">Folder is empty.</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MediaTile({ file }: { file: MediaFile }) {
  const isVideo = (file.mimeType ?? "").startsWith("video/");
  const [imgOk, setImgOk] = useState(true);
  return (
    <a
      href={file.webViewLink}
      target="_blank"
      rel="noopener noreferrer"
      title={file.name}
      className="relative block aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
    >
      {file.thumbnailLink && imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.thumbnailLink}
          alt={file.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center">
          <span className="text-2xl" aria-hidden>{isVideo ? "🎬" : "🖼️"}</span>
          <span className="line-clamp-2 text-[9px] text-neutral-500">{file.name}</span>
        </div>
      )}
      {isVideo ? <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">▶</span> : null}
    </a>
  );
}
