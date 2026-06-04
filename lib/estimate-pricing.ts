// Canonical estimate line pricing — the "4 questions + form" math (Danny
// 2026-06-02): hours × crew rate + materials ×1.3. Extracted here so the
// builder UI (MultiOptionEstimateBuilder) and server-side pushers (studio
// pushStudioDraft) share ONE source of truth — the 185/250/+85 ladder and the
// ×1.3 markup must never diverge. Pure functions; safe on client and server.

/** Crew hourly rate: 1 = $185, 2 = $250, 3+ = 250 + (n−2)×85. */
export function rateFor(crew: number): number {
  if (crew <= 1) return 185;
  if (crew === 2) return 250;
  return 250 + (crew - 2) * 85;
}

/** Line price in DOLLARS: hours × rate(crew) + materials × 1.3. Inputs may be strings. */
export function linePriceDollars(hours: number | string, crew: number | string, materials: number | string): number {
  const c = Math.max(1, Math.min(7, parseInt(String(crew), 10) || 1));
  const h = parseFloat(String(hours)) || 0;
  const m = Math.max(0, parseFloat(String(materials)) || 0);
  return h * rateFor(c) + m * 1.3;
}

/** Line price in INTEGER CENTS (what HCP's create-estimate-direct expects). */
export function linePriceCents(hours: number | string, crew: number | string, materials: number | string): number {
  return Math.round(linePriceDollars(hours, crew, materials) * 100);
}

/** Materials cost in INTEGER CENTS (the raw cost basis HCP tracks separately from sell price). */
export function materialsCostCents(materials: number | string): number {
  return Math.round(Math.max(0, parseFloat(String(materials)) || 0) * 100);
}

/** True when a numeric field is NON-EMPTY yet fails to parse — a typo (e.g. "tow")
 *  that would otherwise silently price to $0. Empty string = intentional, returns false. */
export function isGarbageNumeric(v: number | string): boolean {
  const s = String(v ?? "").trim();
  if (s === "") return false;
  return Number.isNaN(parseFloat(s));
}
