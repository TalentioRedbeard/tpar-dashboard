"use client";

// Landing chooser for the top-nav "Gallery" item (when /gallery has no scope/id yet):
// search a job (invoice / customer name) or a customer, then open their photos. Results
// are tech-scoped server-side (searchGalleryTargets). (Danny 2026-06-15.)

import { useState, useTransition } from "react";
import Link from "next/link";
import { searchGalleryTargets, type GalleryTarget } from "../lib/gallery-actions";

export function GalleryChooser() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GalleryTarget[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    start(async () => {
      const r = await searchGalleryTargets(q);
      setResults(r);
      setSearched(true);
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <form onSubmit={go} className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a job # / invoice or customer name…"
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button type="submit" disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      {searched && results.length === 0 ? (
        <p className="text-sm text-neutral-500">No matches — try an invoice number or customer name.</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          {results.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <Link href={`/gallery?scope=${r.kind}&id=${encodeURIComponent(r.id)}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-neutral-50">
                <span className="text-sm text-neutral-900">
                  <span aria-hidden>{r.kind === "customer" ? "👤 " : "📋 "}</span>{r.label}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">{r.sub}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-neutral-400">Tip: you can also open any job or customer and tap the <span className="font-medium">📷 Photos</span> button.</p>
    </div>
  );
}
