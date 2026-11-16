import { applyPercent } from "@/src/lib/money";

// What a shop-wide price change would do, worked out before anything is sent.
// The server applies the same rule to every active product in the category
// (migration 000010: greatest(0, round(price * (1 + percent / 100)))), so the
// owner is shown the real result, not an estimate.

export type BulkPriceProduct = {
  name: string;
  selling_price_cents: number;
  // Owner's buying price; null or 0 when the product was never received.
  current_cost_cents?: number | null;
};

export type BulkPriceSample = { name: string; before: number; after: number };

export type BulkPricePreview = {
  // Products whose price actually changes (a tiny percentage can round to no change).
  changed: number;
  // Products the change covers, changed or not.
  total: number;
  // Would sell below their buying price afterwards, and did not before.
  newlyBelowCost: number;
  // Price would become 0.
  freeAfter: number;
  // A few real before/after prices, spread across the list.
  samples: BulkPriceSample[];
};

// The percentage must be a real change that cannot take a price to zero or
// below, and not so large that it is certainly a typo (+1000% = ten times).
export const MIN_BULK_PERCENT = -99;
export const MAX_BULK_PERCENT = 1000;

export function validBulkPercent(percent: number): boolean {
  return (
    Number.isFinite(percent) &&
    percent !== 0 &&
    percent >= MIN_BULK_PERCENT &&
    percent <= MAX_BULK_PERCENT
  );
}

export function previewBulkPrice(
  products: BulkPriceProduct[],
  percent: number,
  sampleCount = 3
): BulkPricePreview {
  const rows = products.map((product) => ({
    ...product,
    after: applyPercent(product.selling_price_cents, percent),
  }));
  const changedRows = rows.filter((row) => row.after !== row.selling_price_cents);
  const belowCost = (price: number, cost: number | null | undefined) =>
    !!cost && cost > 0 && price < cost;
  // Spread the samples over the list (first, middle, last) rather than the
  // first three, which all sit under the same letter of the alphabet.
  const picks =
    changedRows.length <= sampleCount
      ? changedRows.map((_, index) => index)
      : Array.from({ length: sampleCount }, (_, i) =>
          Math.floor((i * (changedRows.length - 1)) / Math.max(1, sampleCount - 1))
        );
  return {
    changed: changedRows.length,
    total: rows.length,
    newlyBelowCost: rows.filter(
      (row) =>
        belowCost(row.after, row.current_cost_cents) &&
        !belowCost(row.selling_price_cents, row.current_cost_cents)
    ).length,
    freeAfter: rows.filter((row) => row.after === 0 && row.selling_price_cents > 0).length,
    samples: picks.map((index) => ({
      name: changedRows[index].name,
      before: changedRows[index].selling_price_cents,
      after: changedRows[index].after,
    })),
  };
}
