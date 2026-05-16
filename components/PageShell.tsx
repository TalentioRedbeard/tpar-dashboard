// PageShell — shared layout primitive for the unified app. Provides a
// page header (title + optional kicker + description + actions) and a
// content area with consistent vertical rhythm.
//
// Also: every page gets a floating ? help button bottom-right. Pages
// pass page-aware HelpContent via the `help` prop; if omitted, the
// bubble renders a generic placeholder.

import type { ReactNode } from "react";
import Link from "next/link";
import { HelpBubble, type HelpContent } from "./HelpBubble";

export function PageShell({
  title,
  description,
  kicker,
  actions,
  backHref,
  backLabel = "Back",
  children,
  contentClassName = "",
  help,
}: {
  title: string;
  description?: ReactNode;
  /** Optional small uppercased label above the title — e.g. section name. */
  kicker?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
  contentClassName?: string;
  /** Optional page-aware help content. Floating "?" button always shows
   *  regardless — passing this just makes the content specific. */
  help?: HelpContent;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          {backHref ? (
            <Link
              href={backHref}
              className="mb-2 inline-flex items-center text-xs font-medium text-neutral-500 hover:text-brand-700"
            >
              ← {backLabel}
            </Link>
          ) : null}
          {kicker ? (
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700">
              {kicker}
            </div>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 md:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm text-neutral-600">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <main className={contentClassName}>{children}</main>
      <HelpBubble content={help} />
    </div>
  );
}
