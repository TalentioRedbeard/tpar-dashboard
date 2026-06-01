// ScrollPanel — bounded-height scroll container for variable-length / real-time
// list panels ("rectangle subject displays"). Danny's rule (2026-06-01): a live
// or growing list should have a UNIFORM bounded height with an internal
// scrollbar, so the page shape stays stable instead of being pushed around as
// the list grows (origin: the Dispatch scheduling advisor ballooning at 8 jobs).
//
// Usage: wrap the existing <ul>/<table> — do NOT change the list's own classes.
//   <ScrollPanel tier="standard"><ul className="space-y-2">{rows}</ul></ScrollPanel>
//
// Heights live ONLY here (named tiers), so "uniform height" is enforced
// structurally — tune a tier once and every panel using it changes. Don't pass
// raw max-h utilities at call sites.

import type { ReactNode } from "react";

const TIER = {
  primary:   "max-h-[600px]", // main feeds / queues that are the page's focus
  standard:  "max-h-96",      // ~384px — the default list panel
  secondary: "max-h-72",      // ~288px — sidebar / supporting lists
  compact:   "max-h-64",      // ~256px — dismissed/done/aged secondary lists
} as const;

export function ScrollPanel({
  tier = "standard",
  className = "",
  children,
}: {
  tier?: keyof typeof TIER;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${TIER[tier]} overflow-y-auto pr-1 ${className}`}>
      {children}
    </div>
  );
}
