// FlagRibbon — the trim under the nav.
// A red field with gold / cream / navy ribbons curving across — *filled* bands
// (not stroked) so their thickness varies along the curves (closed-path top
// and bottom edges with slightly different waves give the "ribbon caught
// mid-twist" feel). Bands are phase-offset (gold + navy in opposite phase,
// cream at a denser cycle) so peaks don't all line up and the tile-repeat is
// far less obvious.

export function FlagRibbon() {
  return (
    <div aria-hidden="true" className="w-full overflow-hidden leading-none">
      <svg width="100%" height="22" className="block">
        <defs>
          <pattern id="tpar-flag-ribbon" width="240" height="22" patternUnits="userSpaceOnUse">
            <rect width="240" height="22" fill="#c8102e" />

            {/* Gold band — wide swell, single wave per tile; thickness ranges
                ~4–11 px because top edge has higher amplitude than bottom. */}
            <path
              d="M0 4 Q60 -1 120 4 T240 4 L240 10 Q180 14 120 10 T0 10 Z"
              fill="#e8a200"
            />

            {/* Cream band — denser cycle (two undulations per tile), narrow. */}
            <path
              d="M0 12 Q40 14 80 12 T160 12 T240 12 L240 14 Q200 12 160 14 T80 14 T0 14 Z"
              fill="#f7f2e4"
            />

            {/* Navy band — phase-shifted (peaks DOWN where gold peaks UP) and
                bigger amplitude on the bottom edge → thicker belly, narrow ends. */}
            <path
              d="M0 17 Q60 21 120 17 T240 17 L240 22 Q180 18 120 22 T0 22 Z"
              fill="#16335c"
            />
          </pattern>
        </defs>
        <rect width="100%" height="22" fill="url(#tpar-flag-ribbon)" />
      </svg>
    </div>
  );
}
