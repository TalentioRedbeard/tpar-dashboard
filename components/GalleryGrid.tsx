"use client";

// Photo gallery grid (Danny 2026-06-15). Thumbnails for a scope (job/customer/estimate/
// segment), click to view full-size in a lightbox, multi-select to open in Drive. Photos
// are Google Drive files (thumbnail + viewer links). Lazy-fetches via getGalleryPhotos so
// the page stays fast. v1.1: true bulk/ZIP download + local thumbnail cache (need Drive API).

import { useEffect, useState, useCallback } from "react";
import { getGalleryPhotos, type GalleryScope, type GalleryPhoto } from "../lib/gallery-actions";

// Drive thumbnail URLs (lh3.googleusercontent.com) accept a size token; upsize for the
// lightbox. Falls through to the original if the pattern doesn't match.
function biggerThumb(url?: string): string | undefined {
  if (!url) return url;
  return url.replace(/=s\d+(-c)?$/, "=s1600");
}

// localStorage cache of the photo LIST per (scope,id) — the slow part on revisit is the
// Drive listing round-trip, not the image bytes. 1h TTL + stale-while-revalidate (render
// cache instantly, refetch in the background) + a manual Refresh. (Danny 2026-06-15.)
// Shared-tablet caveat: caches list metadata in the browser; the gallery is still
// tech-scoped server-side, and the list is non-sensitive thumbnail metadata.
const GALLERY_CACHE_TTL_MS = 60 * 60 * 1000;
function galleryCacheKey(scope: string, id: string): string { return `tpar.gallery.${scope}.${id}`; }
function readGalleryCache(scope: string, id: string): { photos: GalleryPhoto[]; capped: boolean; ts: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(galleryCacheKey(scope, id));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !Array.isArray(v.photos) || typeof v.ts !== "number") return null;
    return v as { photos: GalleryPhoto[]; capped: boolean; ts: number };
  } catch { return null; }
}
function writeGalleryCache(scope: string, id: string, photos: GalleryPhoto[], capped: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(galleryCacheKey(scope, id), JSON.stringify({ photos, capped, ts: Date.now() })); } catch { /* quota/full — ignore */ }
}
function agoLabel(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function GalleryGrid({ scope, id }: { scope: GalleryScope; id: string }) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [capped, setCapped] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cachedTs, setCachedTs] = useState<number | null>(null);

  // Stale-while-revalidate: render the cached list instantly, then revalidate in the
  // background; on a cache miss, fetch fresh (spinner).
  useEffect(() => {
    let alive = true;
    setSelected(new Set());
    (async () => {
      setErr(null);
      const cached = readGalleryCache(scope, id);
      if (cached) {
        if (!alive) return;
        setPhotos(cached.photos); setCapped(cached.capped); setCachedTs(cached.ts); setState("done");
        if (Date.now() - cached.ts < GALLERY_CACHE_TTL_MS) return; // fresh enough — no network
        setRefreshing(true);
      } else {
        setState("loading"); setCachedTs(null);
      }
      const r = await getGalleryPhotos(scope, id);
      if (!alive) return;
      if (!r.ok) { if (!cached) { setErr(r.error); setState("error"); } setRefreshing(false); return; }
      setPhotos(r.photos); setCapped(r.capped); setState("done"); setCachedTs(Date.now()); setRefreshing(false);
      writeGalleryCache(scope, id, r.photos, r.capped);
    })();
    return () => { alive = false; };
  }, [scope, id]);

  async function refresh() {
    setRefreshing(true); setErr(null);
    const r = await getGalleryPhotos(scope, id);
    if (!r.ok) { setErr(r.error); setRefreshing(false); return; }
    setPhotos(r.photos); setCapped(r.capped); setState("done"); setCachedTs(Date.now()); setRefreshing(false);
    writeGalleryCache(scope, id, r.photos, r.capped);
  }

  const toggle = useCallback((fid: string) => {
    setSelected((s) => { const n = new Set(s); if (n.has(fid)) n.delete(fid); else n.add(fid); return n; });
  }, []);

  function downloadSelected() {
    // Trigger a real download per selected photo via the drive-media proxy (works for any
    // tech — server proxies the bytes). Staggered so the browser doesn't block the batch.
    const list = photos.filter((p) => selected.has(p.id) && p.downloadProxyUrl);
    list.forEach((p, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = p.downloadProxyUrl!;
        a.download = p.name || "photo";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
  }

  if (state === "loading") return <div className="text-sm text-neutral-500">Loading photos from Drive…</div>;
  if (state === "error") return <div className="text-sm text-red-600">{err}</div>;
  if (photos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-500">
        No photos found for this {scope}. Photos submitted via the Slack #job-media flow appear here once synced to Drive.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600">
        <span>{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
        {capped ? <span className="text-amber-600">· showing the first jobs only (large customer — open a specific job for the rest)</span> : null}
        <button type="button" onClick={refresh} disabled={refreshing}
          className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
          {refreshing ? "refreshing…" : "↻ refresh"}
        </button>
        {cachedTs && !refreshing ? <span className="text-[11px] text-neutral-400">cached {agoLabel(cachedTs)}</span> : null}
        {selected.size > 0 ? (
          <button type="button" onClick={downloadSelected} className="ml-auto rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
            ⬇ Download {selected.size} selected
          </button>
        ) : (
          <span className="ml-auto text-xs text-neutral-400">Tap a photo to view full-size · check to multi-select</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {photos.map((p, i) => (
          <GalleryTile key={p.id} photo={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} onOpen={() => setLightbox(i)} />
        ))}
      </div>

      {lightbox !== null && photos[lightbox] ? (
        <Lightbox
          photo={photos[lightbox]}
          hasPrev={lightbox > 0}
          hasNext={lightbox < photos.length - 1}
          onPrev={() => setLightbox((x) => (x !== null && x > 0 ? x - 1 : x))}
          onNext={() => setLightbox((x) => (x !== null && x < photos.length - 1 ? x + 1 : x))}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

function GalleryTile({ photo, selected, onToggle, onOpen }: { photo: GalleryPhoto; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const isVideo = (photo.mimeType ?? "").startsWith("video/");
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className={`relative aspect-square overflow-hidden rounded-lg border bg-neutral-100 ${selected ? "border-brand-500 ring-2 ring-brand-400" : "border-neutral-200"}`}>
      <button type="button" onClick={onOpen} title={photo.name} className="block h-full w-full">
        {(photo.thumbProxyUrl || photo.thumbnailLink) && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.thumbProxyUrl ?? photo.thumbnailLink} alt={photo.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center">
            <span className="text-2xl" aria-hidden>{isVideo ? "🎬" : "🖼️"}</span>
            <span className="line-clamp-2 text-[9px] text-neutral-500">{photo.name}</span>
          </div>
        )}
      </button>
      <label className="absolute left-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-white/85 shadow">
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-3.5 w-3.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500" />
      </label>
      {isVideo ? <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">▶</span> : null}
    </div>
  );
}

function Lightbox({ photo, hasPrev, hasNext, onPrev, onNext, onClose }: {
  photo: GalleryPhoto; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onPrev, onNext, onClose]);

  const isVideo = (photo.mimeType ?? "").startsWith("video/");
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4" onClick={onClose}>
      <div className="flex items-center justify-between text-sm text-white/90" onClick={(e) => e.stopPropagation()}>
        <span className="truncate">{photo.folderLabel} · {photo.name}</span>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 hover:bg-white/10">close ✕</button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {hasPrev ? <button type="button" onClick={onPrev} className="px-3 text-3xl text-white/70 hover:text-white">‹</button> : <span className="px-3" />}
        {isVideo ? (
          <a href={photo.webViewLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white/10 px-6 py-10 text-center text-white">🎬 Open video in Drive ↗</a>
        ) : (photo.lightboxProxyUrl || photo.thumbnailLink) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.lightboxProxyUrl ?? biggerThumb(photo.thumbnailLink)} alt={photo.name} referrerPolicy="no-referrer" className="max-h-full max-w-full rounded-lg object-contain" />
        ) : (
          <div className="text-white/70">No preview</div>
        )}
        {hasNext ? <button type="button" onClick={onNext} className="px-3 text-3xl text-white/70 hover:text-white">›</button> : <span className="px-3" />}
      </div>
      <div className="flex items-center justify-center gap-3 pt-2" onClick={(e) => e.stopPropagation()}>
        <a href={photo.downloadProxyUrl ?? photo.webViewLink} download={photo.name} target="_blank" rel="noopener noreferrer" className="rounded-md bg-white/90 px-4 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white">
          ⬇ Download full-size
        </a>
      </div>
    </div>
  );
}
