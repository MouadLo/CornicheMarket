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

export function daysOfStockLeft(quantitySold30d: number, stockQuantity: number): number | null {
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

export function lossValueCents(quantityDelta: number, unitCostCents: number | null): number | null {
  if (unitCostCents === null) return null;
  // Only write-offs are losses; a positive correction is stock found, not lost.
  if (quantityDelta >= 0) return 0;
  return Math.round(-quantityDelta * unitCostCents);
}

// Same pattern as unitLabel.ts: a generic (t: Translate) param instead of
// importing i18next's own TFunction type.
type Translate = (key: string, options?: Record<string, unknown>) => string;

// What a stock adjustment is about to do, in one sentence: the quantity
// change and, for the owner, its value. Shared by the inline preview on
// the Adjust screen and the confirm dialog that gates saving it, so the
// two never say something different.
export function adjustmentPreviewMessage(
  stockQuantity: number,
  quantityDelta: number,
  unit: string,
  lossCents: number | null,
  formatMAD: (cents: number) => string,
  t: Translate
): string {
  const after = Number((stockQuantity + quantityDelta).toFixed(3));
  const base = t("stockIn.adjustPreview", {
    before: stockQuantity,
    after,
    unit,
  });
  return lossCents !== null && lossCents > 0 ? `${base} · ${formatMAD(lossCents)}` : base;
}

// How long a product has been in negative stock, for the owner's negative-
// stock screen. stock_went_negative_at is cleared (null) the moment stock
// returns to zero or above, so null here means "not currently negative."
export function daysNegative(wentNegativeAt: string | null, now: Date = new Date()): number | null {
  if (!wentNegativeAt) return null;
  const elapsedMs = now.getTime() - new Date(wentNegativeAt).getTime();
  return Math.max(0, elapsedMs / (1000 * 60 * 60 * 24));
}
