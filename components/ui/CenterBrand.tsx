// CenterBrand — the persistent company identity in the gold banner. Renders as a
// flex-1 wrapper that sits AFTER the primary nav links and BEFORE the right-side
// actions, so the wordmark centers in the genuine empty gap (never overlapping the
// links the way a dead-center absolute element did). The wrapper also acts as the
// banner's flex spacer (keeps the action cluster edge-aligned) — so it is present
// from md up, but the wordmark itself only shows on lg+ where there's real room.
// A small 3-stroke ribbon flourish (navy/red/navy → reads on gold) echoes the
// FlagRibbon trim. Links to Home.

import Link from "next/link";

export function CenterBrand() {
  return (
    <div className="hidden flex-1 items-center justify-center md:flex">
      <Link
        href="/"
        aria-label="Tulsa Plumbing & Remodeling — home"
        className="hidden items-center gap-2 rounded-md px-2 py-1 transition hover:bg-gold-400/50 lg:flex"
      >
        <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
          <path d="M1 6 Q6 3 11 6 T21 6" fill="none" stroke="#16335c" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M1 11 Q6 14 11 11 T21 11" fill="none" stroke="#c8102e" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M1 16 Q6 13 11 16 T21 16" fill="none" stroke="#16335c" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-navy-900">
          Tulsa Plumbing <span className="text-flagred-600">&amp;</span> Remodeling
        </span>
      </Link>
    </div>
  );
}
