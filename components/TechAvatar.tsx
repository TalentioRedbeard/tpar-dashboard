// Small tech avatar — photo if we have one (scraped from HCP / uploaded), else a
// deterministic colored-initials circle. Used on dispatch lanes + schedule for
// quick mental association (Danny 2026-05-30).

const COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-600", "bg-indigo-500", "bg-teal-600",
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const ii = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  return ii || "?";
}

export function TechAvatar({ shortName, avatarUrl, size = 28, colorHex }: { shortName: string; avatarUrl?: string | null; size?: number; colorHex?: string | null }) {
  // When an assigned color is provided, ring/tint with it (consistent across
  // schedule, dispatch lanes, and the map); otherwise keep the neutral ring +
  // hash-color fallback.
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt={shortName}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${colorHex ? "" : "ring-1 ring-neutral-200"}`}
        style={{ width: size, height: size, ...(colorHex ? { boxShadow: `0 0 0 2px ${colorHex}` } : {}) }}
      />
    );
  }
  return (
    <span
      title={shortName}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${colorHex ? "" : colorFor(shortName)}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ...(colorHex ? { backgroundColor: colorHex } : {}) }}
    >
      {initials(shortName)}
    </span>
  );
}
