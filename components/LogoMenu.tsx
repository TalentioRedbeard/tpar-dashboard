"use client";

// The TPAR-DB wordmark doubles as a full-app menu: click it to open a red
// (Tulsa-flag) dropdown listing every feature, grouped. This fixes features
// being scrolled off the end of the gold banner — everything is reachable here.

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Wordmark } from "./ui/Brand";

type MenuItem = { href: string; label: string };
type MenuSection = { title: string; items: MenuItem[] };

export function LogoMenu({ sections }: { sections: MenuSection[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open menu"
        className="flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-gold-400"
      >
        <Wordmark size="md" />
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`text-navy-900 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-flagred-700 bg-flagred-600 text-white shadow-2xl ring-1 ring-black/10"
        >
          <div className="max-h-[72vh] overflow-y-auto p-1.5">
            {sections.map((s) => (
              <div key={s.title} className="px-1 py-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                  {s.title}
                </div>
                <ul>
                  {s.items.map((it) => (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        onClick={() => setOpen(false)}
                        className="block rounded-md px-2 py-1.5 text-sm text-white/95 transition hover:bg-flagred-700"
                      >
                        {it.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
