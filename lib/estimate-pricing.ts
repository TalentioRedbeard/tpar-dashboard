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

// ── Phase 2: modifier compute engine ─────────────────────────────────────────
// Pure. Applies the selected price_modifiers to ONE option's lines and returns
// the adjusted line prices + the transparent extra lines (equipment, permit,
// discount) that land in HCP. Generalizes the hardcoded excavator logic to
// every effect_type. Dollars throughout.

// The compute-relevant slice of a price_modifiers row (loadEstimateModifiers
// returns a structural superset, so it passes here directly).
export type PriceModifier = {
  key: string;
  name: string;
  effectType: string; // hourly_rate_add | labor_multiplier | equipment_charge | permit | flat_discount | promo_price | floor_price
  rateAddPerJob: number | null;
  rateAddPerAdditionalTech: number | null;
  laborMultiplier: number | null;
  dailyRate: number | null;
  deliveryCharge: number | null;
  minIncrement: number | null;
  floorAmount: number | null;
  floorHoursThreshold: number | null;
  hourlyRateAfterFloor: number | null;
  discountAmount: number | null;
  promoPrice: number | null;
};

export type ModLine = { hours: number | string; crew: number | string; materials: number | string; modifierKeys?: string[] };
export type ComputedLine = { basePrice: number; price: number; rateMods: string[]; laborMods: string[] };
export type ExtraLine = { name: string; price: number; kind: "equipment" | "permit" | "discount"; modifierKey: string };

export function applyOptionModifiers(
  lines: ModLine[],
  defs: Record<string, PriceModifier>,
): { lines: ComputedLine[]; extraLines: ExtraLine[]; optionTotal: number } {
  const computed: ComputedLine[] = [];
  const extraLines: ExtraLine[] = [];
  const onceSeen = new Set<string>(); // de-dup option-level adds (equipment/permit/discount) across lines
  // Option-level equipment/permit size off the option's TOTAL labor hours (matches the excavator rule).
  const optionHours = lines.reduce((s, l) => s + (parseFloat(String(l.hours)) || 0), 0);

  for (const l of lines) {
    const crew = Math.max(1, Math.min(7, parseInt(String(l.crew), 10) || 1));
    const hours = parseFloat(String(l.hours)) || 0;
    const materials = Math.max(0, parseFloat(String(l.materials)) || 0);
    const keys = l.modifierKeys ?? [];
    const basePrice = hours * rateFor(crew) + materials * 1.3;

    // 1) hourly_rate_add — stack premiums onto the crew rate (gas, certs, specialty)
    let rate = rateFor(crew);
    const rateMods: string[] = [];
    for (const k of keys) {
      const m = defs[k];
      if (m?.effectType === "hourly_rate_add") {
        rate += (m.rateAddPerJob ?? 0) + (m.rateAddPerAdditionalTech ?? 0) * (crew - 1);
        rateMods.push(k);
      }
    }
    let labor = hours * rate;

    // 2) labor_multiplier — emergency / increased-liability premium ON labor only
    const laborMods: string[] = [];
    for (const k of keys) {
      const m = defs[k];
      if (m?.effectType === "labor_multiplier") {
        labor *= 1 + (m.laborMultiplier ?? 0);
        laborMods.push(k);
      }
    }

    let price = labor + materials * 1.3;
    // 3) promo_price — fixed price for the covered scope (overrides)
    for (const k of keys) {
      const m = defs[k];
      if (m?.effectType === "promo_price" && m.promoPrice != null) price = m.promoPrice;
    }
    // 4) floor_price — never below the floor
    for (const k of keys) {
      const m = defs[k];
      if (m?.effectType === "floor_price" && m.floorAmount != null) price = Math.max(price, m.floorAmount);
    }
    computed.push({ basePrice, price, rateMods, laborMods });

    // 5) equipment_charge + permit → transparent option line (once per modifier)
    for (const k of keys) {
      const m = defs[k];
      if (!m || onceSeen.has(k)) continue;
      if (m.effectType === "equipment_charge") {
        onceSeen.add(k);
        let fee = 0;
        if (m.dailyRate != null) {
          const inc = m.minIncrement || 0.5;
          const days = Math.max(inc, Math.ceil(optionHours / 8 / inc) * inc);
          fee = days * m.dailyRate + (m.deliveryCharge ?? 0);
        } else if (m.floorAmount != null) {
          fee = m.floorAmount + Math.max(0, optionHours - (m.floorHoursThreshold ?? 0)) * (m.hourlyRateAfterFloor ?? 0);
        }
        if (fee > 0) extraLines.push({ name: m.name, price: fee, kind: "equipment", modifierKey: k });
      } else if (m.effectType === "permit") {
        onceSeen.add(k);
        const fee = m.rateAddPerJob ?? 0;
        if (fee > 0) extraLines.push({ name: m.name, price: fee, kind: "permit", modifierKey: k });
      }
    }
  }

  // 6) flat_discount → option-level negative line (once per modifier)
  for (const l of lines) {
    for (const k of l.modifierKeys ?? []) {
      const m = defs[k];
      if (m?.effectType === "flat_discount" && !onceSeen.has(k) && m.discountAmount != null) {
        onceSeen.add(k);
        extraLines.push({ name: m.name, price: -m.discountAmount, kind: "discount", modifierKey: k });
      }
    }
  }

  const optionTotal =
    computed.reduce((s, l) => s + l.price, 0) + extraLines.reduce((s, e) => s + e.price, 0);
  return { lines: computed, extraLines, optionTotal };
}
