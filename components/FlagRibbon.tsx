// FlagRibbon — the trim under the nav. A red field with gold/cream/navy bands
// curving across, echoing the flowing bands of the Tulsa flag on the shop door
// (instead of the old hard checker stripes). Tiles seamlessly at any width.

export function FlagRibbon() {
  return (
    <div aria-hidden="true" className="w-full overflow-hidden leading-none">
      <svg width="100%" height="22" className="block">
        <defs>
          <pattern id="tpar-flag-ribbon" width="180" height="22" patternUnits="userSpaceOnUse">
            <rect width="180" height="22" fill="#c8102e" />
            {/* three parallel sweeping bands — same wave, offset + colored */}
            <path d="M0 7 Q45 1 90 7 T180 7"   fill="none" stroke="#e8a200" strokeWidth="5"   strokeLinecap="round" />
            <path d="M0 12 Q45 6 90 12 T180 12" fill="none" stroke="#f7f2e4" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M0 16 Q45 10 90 16 T180 16" fill="none" stroke="#16335c" strokeWidth="4.5" strokeLinecap="round" />
          </pattern>
        </defs>
        <rect width="100%" height="22" fill="url(#tpar-flag-ribbon)" />
      </svg>
    </div>
  );
}
