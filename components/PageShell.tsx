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
import { AskBar } from "./AskBar";
import { BackButton } from "./BackButton";
import { getCurrentTech } from "../lib/current-tech";
import { isOwner } from "../lib/admin";

export async function PageShell({
  title,
  icon,
  titleClassName,
  description,
  kicker,
  actions,
  backHref,
  backLabel = "Back",
  children,
  contentClassName = "",
  help,
  hideAskBar = false,
}: {
  title: string;
  /** Optional section emoji/icon shown before the title in the header band. */
  icon?: string;
  /** Override the default title classes (e.g. larger/bolder per page). */
  titleClassName?: string;
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
  /** Opt out of the persistent AI ask bar (e.g. focused form flows that
   *  already embed AppGuide). Defaults to showing it. */
  hideAskBar?: boolean;
}) {
  // Owner-only: can edit the "?" help content inline. Uses realEmail so it
  // holds even while impersonating a tech via /admin/view-as. (The "Viewing
  // as" banner renders once globally in app/layout.tsx — NOT here — so it no
  // longer doubles up on PageShell pages.)
  const me = await getCurrentTech().catch(() => null);
  const canEditHelp = isOwner(me?.realEmail);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 rounded-2xl border-2 border-neutral-400 border-t-[4px] border-t-navy-700 bg-gradient-to-br from-white to-neutral-50/70 px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {backHref ? (
              <Link
                href={backHref}
                className="mb-2 inline-flex items-center text-xs font-medium text-neutral-500 hover:text-brand-700"
              >
                ← {backLabel}
              </Link>
            ) : (
              <BackButton />
            )}
            {kicker ? (
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700">
                {kicker}
              </div>
            ) : null}
            <h1 className={titleClassName || "text-2xl font-semibold tracking-tight text-neutral-900 md:text-3xl"}>
              {icon ? <span className="mr-2" aria-hidden>{icon}</span> : null}
              {title}
            </h1>
            {description ? (
              <p className="mt-1.5 max-w-2xl text-sm text-neutral-600">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      {hideAskBar ? null : <AskBar pageTitle={title} />}
      <main className={contentClassName}>{children}</main>
      <HelpBubble content={help} canEdit={canEditHelp} />
    </div>
  );
}
