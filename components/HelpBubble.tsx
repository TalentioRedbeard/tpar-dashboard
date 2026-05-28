"use client";

// HelpBubble — floating "?" button at the bottom-right of every page.
//
// Click → slides up a panel with page-aware "what this is for / what you can
// do here / examples." Content precedence:
//   1. DB override (page_help, edited inline by the owner)  ← highest
//   2. the hardcoded `content` prop the page passes
//   3. a generic placeholder
//
// The owner (and only the owner — see canEdit, gated server-side by
// requireOwner) gets an Edit button that writes the DB override live, no
// deploy needed. Built for techs who weren't hired for tech literacy — content
// is short, casual, one-glance.

import { useState, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getPageHelp, savePageHelp, type PageHelpData } from "../app/help/actions";
import { helpKeyForPath } from "../lib/help-key";

export type HelpContent = {
  /** One-sentence "what is this page for?" — casual, not formal. */
  intent: string;
  /** Things they can DO here. Each is a short verb-led line. */
  actions?: string[];
  /** Optional "if you're stuck" follow-ups (link to another page, a Slack channel, etc). */
  stuck?: ReactNode;
};

const GENERIC: HelpContent = {
  intent: "This page is part of the TPAR dashboard. Hit the buttons to do the things they say. If something is confusing, ping Danny.",
  actions: [
    "Look around — nothing here can break by being clicked.",
    "Hit ← Back if you got here by accident.",
  ],
};

export function HelpBubble({ content, canEdit = false }: { content?: HelpContent; canEdit?: boolean }) {
  const pathname = usePathname();
  const c = content ?? GENERIC;

  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dbContent, setDbContent] = useState<PageHelpData | null>(null);

  // Edit mode (owner only)
  const [editing, setEditing] = useState(false);
  const [fIntent, setFIntent] = useState("");
  const [fActions, setFActions] = useState("");
  const [fStuck, setFStuck] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Effective display content — DB override wins, else the page's prop / generic.
  const displayIntent = dbContent ? dbContent.intent : c.intent;
  const displayActions: string[] = dbContent ? dbContent.actions : (c.actions ?? []);
  const displayStuck: ReactNode = dbContent ? dbContent.stuck : (c.stuck ?? null);

  // Lazy-load the DB override the first time the panel opens.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    getPageHelp(pathname)
      .then((res) => { if (!cancelled) setDbContent(res); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [open, loaded, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setEditing(false); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function startEditing() {
    // Seed the form from whatever is currently shown (DB override or the
    // hardcoded default), so editing a generic page starts from its baseline.
    setFIntent(displayIntent);
    setFActions(displayActions.join("\n"));
    setFStuck(dbContent?.stuck ?? "");
    setSaveErr(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaveErr(null);
    const payload: PageHelpData = {
      intent: fIntent,
      actions: fActions.split("\n").map((s) => s.trim()).filter(Boolean),
      stuck: fStuck.trim() ? fStuck.trim() : null,
    };
    const res = await savePageHelp(pathname, payload);
    setSaving(false);
    if (!res.ok) { setSaveErr(res.error ?? "Save failed."); return; }
    setDbContent(payload);
    setEditing(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="What can I do on this page?"
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-2xl font-semibold text-white shadow-lg shadow-brand-900/30 transition hover:bg-brand-700 hover:shadow-xl active:scale-95 md:bottom-6 md:right-6"
      >
        {open ? "×" : "?"}
      </button>

      {open ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 flex justify-end px-4 pb-20 md:px-6 md:pb-24"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pointer-events-auto w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl shadow-neutral-900/20"
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-neutral-900">What this page is for</h3>
              <div className="flex items-center gap-3">
                {canEdit && !editing ? (
                  <button type="button" onClick={startEditing} className="text-xs font-medium text-brand-700 hover:text-brand-900">
                    Edit
                  </button>
                ) : null}
                <button type="button" onClick={() => { setEditing(false); setOpen(false); }} className="text-xs text-neutral-500 hover:text-neutral-800">
                  close (Esc)
                </button>
              </div>
            </div>

            {editing ? (
              <div className="space-y-3">
                <div className="rounded-md bg-brand-50 px-2 py-1 text-[11px] text-brand-800">
                  Editing help for <code className="font-mono">{helpKeyForPath(pathname)}</code>
                  {helpKeyForPath(pathname).includes(":id") ? " — applies to all pages of this type." : ""}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">One-line: what is this page for?</label>
                  <textarea
                    value={fIntent}
                    onChange={(e) => setFIntent(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">What you can do here (one per line)</label>
                  <textarea
                    value={fActions}
                    onChange={(e) => setFActions(e.target.value)}
                    rows={5}
                    placeholder={"Tap a job to open it\nHit Start when you arrive"}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Still stuck? (optional)</label>
                  <input
                    value={fStuck}
                    onChange={(e) => setFStuck(e.target.value)}
                    placeholder="e.g. Text Danny, or check #dispatch"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                {saveErr ? <p className="text-xs text-red-700">{saveErr}</p> : null}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={save} disabled={saving} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-neutral-800">{displayIntent}</p>

                {displayActions.length > 0 ? (
                  <>
                    <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">What you can do here</div>
                    <ul className="mt-2 space-y-1.5">
                      {displayActions.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-neutral-800">
                          <span className="mt-0.5 text-brand-700">→</span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {displayStuck ? (
                  <>
                    <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Still stuck?</div>
                    <div className="mt-2 text-sm text-neutral-700">{displayStuck}</div>
                  </>
                ) : null}

                <div className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                  Type a question on <a href="/ask" className="font-medium underline hover:text-neutral-800">/ask</a> if your situation isn&apos;t covered here. Or text Danny.
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
