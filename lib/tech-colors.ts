// Per-tech assigned colors (Madisson meeting #3). Source of truth =
// tech_directory.color_hex (seeded migration 20260601020000). Falls back to a
// deterministic hash hue for anyone without an assigned color (former techs, a
// new hire before seeding) so the UI never breaks. The return is a hex string —
// apply it via inline style (backgroundColor / borderColor); an arbitrary hex
// can't be a Tailwind class, which is why the old class-based palettes diverged.

const FALLBACK = ["#64748b", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#4f46e5", "#ca8a04"];

export function hashColorHex(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

// Build with new Map(techs.map(t => [t.hcp_full_name, t.color_hex])).
export function resolveTechColor(fullName: string | null | undefined, colorByFull: Map<string, string | null>): string {
  if (!fullName) return "#94a3b8"; // slate-400 — unassigned / unknown
  return colorByFull.get(fullName) || hashColorHex(fullName);
}
