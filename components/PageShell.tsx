// PageShell — shared layout primitive for the unified app. Provides a
// page header (title + optional description + actions) and a content area.

import type { ReactNode } from "react";

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-neutral-600">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <main>{children}</main>
    </div>
  );
}

export function StubCard({ note }: { note: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
      <p className="text-sm text-neutral-600">{note}</p>
      <p className="mt-2 text-xs text-neutral-400">
        Phase 2 of the unified-app build will populate this page with real data.
        See <code>docs/UNIFIED_UI_DESIGN.md</code>.
      </p>
    </div>
  );
}
