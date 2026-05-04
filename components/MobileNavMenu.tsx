"use client";

// Mobile drawer menu for the dashboard nav. Phone-first; on md+ screens this
// component renders nothing (the desktop horizontal nav takes over).
//
// Per Danny 2026-05-04: horizontal-scroll nav on iPhone width was cutting
// off mid-word ("Cu..."). Hamburger drawer fixes discoverability + keeps the
// top bar tight.
//
// 2026-05-04 (later): drawer wasn't visible because the parent <nav> uses
// backdrop-filter (backdrop-blur), which creates a stacking context that
// CONTAINS position:fixed descendants — so the drawer wasn't escaping to
// the viewport. Fix: portal the drawer to document.body so it renders
// outside the nav's stacking context.

import Link from "next/link";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface NavSection {
  title: string;
  items: Array<{ href: string; label: string; tone?: "default" | "tech" | "admin" | "manager" }>;
}

export function MobileNavMenu({
  sections,
  userEmail,
}: {
  sections: NavSection[];
  userEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // createPortal needs document.body, which only exists client-side.
  useEffect(() => { setMounted(true); }, []);

  // Lock body scroll while drawer open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  const drawer = open ? (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50 md:hidden"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 z-[101] flex h-full w-72 flex-col overflow-y-auto border-l border-neutral-200 bg-white shadow-xl md:hidden">
        <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
          <span className="text-sm font-semibold text-neutral-800">Menu</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 px-3 py-4">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                {section.title}
              </h3>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const toneCls =
                    item.tone === "tech"
                      ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                      : item.tone === "admin"
                      ? "text-accent-700 hover:bg-accent-50"
                      : item.tone === "manager"
                      ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"
                      : "text-neutral-700 hover:bg-neutral-100";
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`block rounded-md px-3 py-2 text-sm font-medium ${toneCls}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {userEmail ? (
          <div className="border-t border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-500">
            Signed in as <span className="font-mono">{userEmail.replace("@tulsapar.com", "")}</span>
            <form action="/auth/signout" method="POST" className="mt-2">
              <button
                type="submit"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 md:hidden"
        aria-label="Open menu"
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Portal the drawer to document.body so it escapes the nav's
          backdrop-filter stacking context (the bug Danny hit 2026-05-04). */}
      {mounted && drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
