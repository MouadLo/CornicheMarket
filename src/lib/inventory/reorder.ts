// How many days of demand a reorder should cover.
export const COVER_DAYS = 14;
const WINDOW_DAYS = 30;

export function dailySalesRate(quantitySold30d: number): number {
  return quantitySold30d / WINDOW_DAYS;
}

// Order enough to cover COVER_DAYS of demand and still finish above the
// product's own low-stock threshold, less whatever is already on the shelf.
// A product that has not sold at all is only topped back up to its threshold:
// buying two weeks of demand for something nobody buys is how cash dies.
export function suggestedReorder(
  quantitySold30d: number,
  stockQuantity: number,
  lowStockThreshold: number,
  unit: string
): number {
  const target = dailySalesRate(quantitySold30d) * COVER_DAYS + lowStockThreshold;
  const needed = target - stockQuantity;
  if (needed <= 0) return 0;
  return roundUpForUnit(needed, unit);
}

// Whole units for countable things; a tenth of a kg is a sensible smallest
// order step for weighed goods.
export function roundUpForUnit(quantity: number, unit: string): number {
  if (unit === "kg") {
    return Math.ceil(quantity * 10) / 10;
  }
  return Math.ceil(quantity);
}

export function daysOfStockLeft(
  quantitySold30d: number,
  stockQuantity: number
): number | null {
  const rate = dailySalesRate(quantitySold30d);
  if (rate <= 0) return null;
  return stockQuantity / rate;
}

// The discrepancy a shelf count found: what was on the shelf versus what the
// system claimed at the moment of counting. Applied as a relative adjustment,
// so stock movements during the count survive.
export function countDiscrepancy(counted: number, systemQuantity: number): number {
  return Number((counted - systemQuantity).toFixed(3));
}

export function stockAfterCount(
  liveQuantity: number,
  counted: number,
  systemQuantityAtCount: number
): number {
  return Number((liveQuantity + countDiscrepancy(counted, systemQuantityAtCount)).toFixed(3));
}

export function lossValueCents(
  quantityDelta: number,
  unitCostCents: number | null
): number | null {
  if (unitCostCents === null) return null;
  // Only write-offs are losses; a positive correction is stock found, not lost.
  if (quantityDelta >= 0) return 0;
  return Math.round(-quantityDelta * unitCostCents);
}
