"use client";

// TrainingPlayer — the interactive playlist behind /training. One inline
// <video> at the top plays the selected chapter; the ordered chapter list
// below lets a tech jump around. Auto-advances to the next chapter on end,
// tracks which chapters have been watched, and remembers progress across
// sessions in localStorage. Phone-first, warm brand styling.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingClip } from "@/lib/training-clips";

const STORE_KEY = "tpar-training-v1";

type Progress = { watched: string[]; last: number };

export function TrainingPlayer({ clips }: { clips: TrainingClip[] }) {
  const [active, setActive] = useState(0);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shouldPlay = useRef(false); // only autoplay after a user gesture

  // Restore progress on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Progress;
        if (Array.isArray(p.watched)) setWatched(new Set(p.watched));
        if (typeof p.last === "number" && p.last >= 0 && p.last < clips.length) setActive(p.last);
      }
    } catch {
      /* ignore corrupt/blocked storage */
    }
    setHydrated(true);
  }, [clips.length]);

  // Persist progress.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ watched: [...watched], last: active }));
    } catch {
      /* ignore */
    }
  }, [watched, active, hydrated]);

  // Load (and optionally play) whenever the active chapter changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.load();
    if (shouldPlay.current) {
      shouldPlay.current = false;
      v.play().catch(() => {
        /* autoplay may be blocked; the poster/controls remain */
      });
    }
  }, [active]);

  const go = useCallback((i: number, play = true) => {
    if (i < 0 || i >= clips.length) return;
    shouldPlay.current = play;
    setActive(i);
    // bring the player into view on small screens
    if (typeof window !== "undefined" && window.scrollY > 120) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [clips.length]);

  const markWatched = useCallback((slug: string) => {
    setWatched((prev) => {
      if (prev.has(slug)) return prev;
      const next = new Set(prev);
      next.add(slug);
      return next;
    });
  }, []);

  const onEnded = useCallback(() => {
    markWatched(clips[active].slug);
    if (autoAdvance && active < clips.length - 1) go(active + 1, true);
  }, [active, autoAdvance, clips, go, markWatched]);

  const resetProgress = useCallback(() => {
    setWatched(new Set());
    go(0, false);
  }, [go]);

  const current = clips[active];
  const watchedCount = watched.size;
  const allDone = watchedCount === clips.length;
  const pct = Math.round((watchedCount / clips.length) * 100);

  return (
    <div className="space-y-5">
      {/* ── Progress summary ── */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-neutral-800">
            Chapter {active + 1} of {clips.length}
          </span>
          <span className="text-xs font-medium text-neutral-500">
            {watchedCount}/{clips.length} watched
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ── Player ── */}
      <div className="overflow-hidden rounded-2xl border border-neutral-300 bg-navy-900 shadow-sm">
        <div className="flex items-center gap-2 px-4 py-2.5 text-white">
          <span className="text-lg" aria-hidden>{current.emoji}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              Chapter {current.n} · {current.title}
            </div>
          </div>
          <span className="ml-auto shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium tabular-nums">
            {current.runtime}
          </span>
        </div>

        {/* key forces a clean element per chapter so controls/state reset */}
        <video
          key={current.slug}
          ref={videoRef}
          className="aspect-video w-full bg-black"
          controls
          playsInline
          preload="metadata"
          onEnded={onEnded}
          onPlay={() => {
            /* nothing — kept for future analytics */
          }}
        >
          <source src={current.url} type="video/mp4" />
          Your browser can&rsquo;t play this video. Open it directly:{" "}
          <a href={current.url} className="underline">{current.title}</a>
        </video>

        {/* transport row */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={() => go(active - 1, true)}
            disabled={active === 0}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-sm font-medium text-white transition enabled:hover:bg-white/10 disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => go(active + 1, true)}
            disabled={active === clips.length - 1}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition enabled:hover:bg-brand-500 disabled:opacity-40"
          >
            Next chapter →
          </button>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-white/80">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent-500)]"
            />
            Autoplay next
          </label>
        </div>
      </div>

      {/* ── Finished banner ── */}
      {allDone ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center">
          <div className="text-2xl" aria-hidden>🎉</div>
          <p className="mt-1 text-sm font-semibold text-emerald-900">
            That&rsquo;s the whole walkthrough — you&rsquo;re set.
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            Come back anytime; your progress is saved on this phone.
          </p>
        </div>
      ) : null}

      {/* ── Playlist ── */}
      <ol className="space-y-2.5">
        {clips.map((clip, i) => {
          const isActive = i === active;
          const isWatched = watched.has(clip.slug);
          return (
            <li key={clip.slug}>
              <button
                type="button"
                onClick={() => go(i, true)}
                aria-current={isActive ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition ${
                  isActive
                    ? "border-brand-400 bg-brand-50 ring-2 ring-brand-200"
                    : "border-neutral-200 bg-white hover:border-brand-300 hover:bg-brand-50/40"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    isWatched
                      ? "bg-emerald-500 text-white"
                      : isActive
                        ? "bg-brand-600 text-white"
                        : "bg-brand-100 text-brand-700"
                  }`}
                >
                  {isWatched ? "✓" : clip.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden>{clip.emoji}</span>
                    <span className="truncate text-sm font-semibold text-neutral-900">
                      {clip.title}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                    {clip.desc}
                  </p>
                </div>
                <span className="shrink-0 self-start rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-neutral-500">
                  {clip.runtime}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* ── Footer: reset ── */}
      <div className="pt-1 text-center">
        <button
          type="button"
          onClick={resetProgress}
          className="text-xs font-medium text-neutral-400 underline-offset-2 hover:text-neutral-600 hover:underline"
        >
          Reset my progress
        </button>
      </div>
    </div>
  );
}
