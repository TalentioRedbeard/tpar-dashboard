// Branded money types — make cents-vs-dollars confusion a COMPILE error.
//
// Why: appointments_master.total_amount is stored in cents. job_360.revenue
// is in dollars. customer_360.outstanding_due_dollars is in dollars. The
// fmtMoney helper expects dollars. Pre-this, mixing them silently rendered
// $168,000 for a $1,680 charge (Danny caught 2026-05-04).
//
// Now: any value typed `Cents` cannot be passed to a function that expects
// `Dollars` without an explicit conversion.
//
// Source-of-truth: this mirrors the pattern intended for
// @tpar-forge/schemas/money. Once tpar-forge monorepo publishing is solid,
// the canonical version lives there and the dashboard imports it. For now
// it lives here.

declare const __cents: unique symbol;
declare const __dollars: unique symbol;

export type Cents = number & { readonly [__cents]: true };
export type Dollars = number & { readonly [__dollars]: true };

/** Branded constructor — wrap a raw number as Cents. Use at the data boundary. */
export function cents(n: number): Cents {
  return n as Cents;
}

/** Branded constructor — wrap a raw number as Dollars. Use at the data boundary. */
export function dollars(n: number): Dollars {
  return n as Dollars;
}

/** Convert cents → dollars at the display layer. Returns Dollars. */
export function centsToDollars(c: Cents | null | undefined): Dollars | null {
  if (c == null) return null;
  return ((c as number) / 100) as Dollars;
}

/** Format dollars for display — `$1,234`. Pure display. */
export function fmtDollars(d: Dollars | null | undefined): string {
  if (d == null) return "—";
  const v = d as number;
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Format cents directly for display — converts internally. */
export function fmtCents(c: Cents | null | undefined): string {
  return fmtDollars(centsToDollars(c));
}
