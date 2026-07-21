"use client";

// A fixed, screen-anchored floating container the user can DRAG by a small grip,
// with its position remembered per-device (Danny 2026-07-21). Built because the
// global recorders live at the top-right and were covering page action buttons +
// the "Exit view-as" banner controls — now they can be moved out of the way.
//
// Anchored by top/right so it stays put on resize the way the recorders always
// did. Drag is via a dedicated grip (not the whole element) so the buttons/inputs
// inside keep working normally. Position is clamped to the viewport.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Pos = { top: number; right: number };

export function DraggableFloat({
  storageKey, defaultTop, defaultRight = 16, z = 60, children,
}: {
  storageKey: string;
  defaultTop: number;
  defaultRight?: number;
  z?: number;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<Pos>({ top: defaultTop, right: defaultRight });
  const [loaded, setLoaded] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  // Restore a saved position; clamp in case the viewport shrank since.
  useEffect(() => {
    try {
      const s = localStorage.getItem(storageKey);
      if (s) {
        const p = JSON.parse(s);
        if (typeof p?.top === "number" && typeof p?.right === "number") {
          setPos({
            top: Math.max(4, Math.min(window.innerHeight - 40, p.top)),
            right: Math.max(4, Math.min(window.innerWidth - 40, p.right)),
          });
        }
      }
    } catch { /* default position */ }
    setLoaded(true);
  }, [storageKey]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Offsets from the pointer to the element's top-RIGHT corner (our anchor).
    grab.current = { dx: rect.right - e.clientX, dy: e.clientY - rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = grab.current, el = elRef.current;
    if (!d || !el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const right = Math.max(4, Math.min(window.innerWidth - w - 4, window.innerWidth - (e.clientX + d.dx)));
    const top = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - d.dy));
    setPos({ top, right });
  }, []);

  const endDrag = useCallback(() => {
    if (!grab.current) return;
    grab.current = null;
    try { localStorage.setItem(storageKey, JSON.stringify(posRef.current)); } catch { /* non-fatal */ }
  }, [storageKey]);

  return (
    <div
      ref={elRef}
      className="fixed print:hidden"
      style={{ top: pos.top, right: pos.right, zIndex: z, visibility: loaded ? "visible" : "hidden" }}
    >
      <div className="relative">
        <button
          type="button"
          aria-label="Drag to move"
          title="Drag to move"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute -left-2.5 -top-2.5 z-10 flex h-6 w-6 cursor-grab touch-none select-none items-center justify-center rounded-full border border-neutral-300 bg-white text-[11px] leading-none text-neutral-500 shadow-sm hover:bg-neutral-50 active:cursor-grabbing"
        >
          ✥
        </button>
        {children}
      </div>
    </div>
  );
}
