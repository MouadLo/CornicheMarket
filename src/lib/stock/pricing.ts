// Threshold at which a new buying price is worth the owner's attention.
export const PRICE_CHANGE_THRESHOLD_PERCENT = 10;

export function priceChangePercent(
  previousCostCents: number,
  newCostCents: number
): number | null {
  if (previousCostCents <= 0) return null;
  return ((newCostCents - previousCostCents) / previousCostCents) * 100;
}

export function isSignificantPriceChange(
  previousCostCents: number,
  newCostCents: number
): boolean {
  const change = priceChangePercent(previousCostCents, newCostCents);
  return change !== null && Math.abs(change) > PRICE_CHANGE_THRESHOLD_PERCENT;
}

// Selling price that keeps the margin the product had at its previous cost.
// Holding margin m = 1 - cost/price constant means price scales with cost,
// so the suggestion is simply the old price times the cost ratio.
export function suggestSellingPrice(
  currentSellingPriceCents: number,
  previousCostCents: number,
  newCostCents: number
): number | null {
  if (previousCostCents <= 0 || currentSellingPriceCents <= 0) return null;
  return Math.round((currentSellingPriceCents * newCostCents) / previousCostCents);
}
