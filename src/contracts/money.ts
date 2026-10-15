/**
 * Money is ALWAYS integer minor units (pence). Never floats, never strings in arithmetic.
 * FROZEN at the A0-02 contract checkpoint.
 */

/** Demo supports GBP only (see policy). Lowercase to match the Stripe API. */
export type Currency = "gbp";

/** Integer number of minor units, e.g. £1,200.00 === 120000. */
export type MinorUnits = number;

export interface Money {
  amountMinor: MinorUnits;
  currency: Currency;
}

/** Throws if the value is not a safe non-negative integer. Use at every money boundary. */
export function assertMinorUnits(value: unknown, label = "amount"): asserts value is MinorUnits {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of minor units`);
  }
}

/** Exact sum of integer minor-unit amounts. */
export function sumMinor(values: readonly MinorUnits[]): MinorUnits {
  let total = 0;
  for (const v of values) {
    assertMinorUnits(v);
    total += v;
  }
  assertMinorUnits(total, "total");
  return total;
}

/** Presentation helper for UI and explanations: 120000 -> "£1,200.00". */
export function formatMoney(amountMinor: MinorUnits, currency: Currency = "gbp"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(
    amountMinor / 100,
  );
}
