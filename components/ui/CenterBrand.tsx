// CenterBrand — the persistent company identity in the empty center of the gold
// banner, so branding "transcends each page". A small 3-stroke ribbon flourish
// (echoing the FlagRibbon trim, in navy/red/navy so it reads on the gold bar) +
// the full company name in navy small-caps. Absolutely centered + pointer-events
// -none so it never blocks the primary links beneath it; only shows on lg+ where
// there's real horizontal room. Links to Home.

import Link from "next/link";

export function CenterBrand() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
      <Link
        href="/"
        aria-label="Tulsa Plumbing & Remodeling — home"
        className="pointer-events-auto flex items-center gap-2 rounded-md px-2 py-1 transition hover:bg-gold-400/50"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
          <path d="M1 6 Q6 3 11 6 T21 6" fill="none" stroke="#16335c" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M1 11 Q6 14 11 11 T21 11" fill="none" stroke="#c8102e" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M1 16 Q6 13 11 16 T21 16" fill="none" stroke="#16335c" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.16em] text-navy-900">
          Tulsa Plumbing <span className="text-flagred-600">&amp;</span> Remodeling
        </span>
      </Link>
    </div>
  );
}
