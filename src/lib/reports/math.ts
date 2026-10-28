// TypeScript mirror of the arithmetic in the report SQL functions. Keeping
// it here lets the same hand-worked examples be asserted in tests, so a
// change to either side shows up as a failure rather than a wrong number
// on screen.

// A basket discount belongs to the sale, not to any line, so it is split
// across lines in proportion to their value. Mirrors sale_line_economics.
//
// Uses the largest-remainder method, not independent per-line rounding:
// each line's exact share is floored, then the leftover centimes (always a
// non-negative integer less than the number of lines, since every floor is
// at most 1 short of its exact share) are handed one at a time to the lines
// with the biggest fractional remainder. This is what guarantees the parts
// always sum to saleDiscountCents exactly. Independent rounding does not --
// e.g. lines [333, 333, 334] with a 10-cent discount round to [3, 3, 3],
// summing to 9, not 10.
export function allocateSaleDiscount(
  lineTotalsCents: number[],
  saleDiscountCents: number
): number[] {
  const total = lineTotalsCents.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || saleDiscountCents <= 0) {
    return lineTotalsCents.map(() => 0);
  }

  const exact = lineTotalsCents.map((lineTotal) => (saleDiscountCents * lineTotal) / total);
  const floors = exact.map((value) => Math.floor(value));
  const floorSum = floors.reduce((sum, value) => sum + value, 0);
  let leftover = saleDiscountCents - floorSum;

  // Ties (equal remainders) go to the lower index first, so the result is
  // deterministic rather than depending on sort stability of equal floats.
  const byRemainderDesc = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = [...floors];
  for (const { index } of byRemainderDesc) {
    if (leftover <= 0) break;
    result[index] += 1;
    leftover -= 1;
  }

  return result;
}

export function netLineRevenue(lineTotalsCents: number[], saleDiscountCents: number): number[] {
  const allocated = allocateSaleDiscount(lineTotalsCents, saleDiscountCents);
  return lineTotalsCents.map((lineTotal, index) => lineTotal - allocated[index]);
}

export function averageBasketCents(revenueCents: number, transactionCount: number): number {
  if (transactionCount <= 0) return 0;
  return Math.round(revenueCents / transactionCount);
}

export function grossMarginPercent(revenueCents: number, cogsCents: number): number | null {
  if (revenueCents <= 0) return null;
  return ((revenueCents - cogsCents) / revenueCents) * 100;
}

export function inventoryPotentialProfitCents(
  retailValueCents: number,
  costValueCents: number
): number {
  return retailValueCents - costValueCents;
}

// Mirrors report_inventory_value's flooring: each product's own
// contribution is floored at zero before summing, so one oversold product
// (negative stock_quantity) can't offset the value of real stock held
// elsewhere -- e.g. 10 units in stock plus one product oversold by -3 units
// is NOT "7 units worth of value"; it is 10 units of real value plus a
// separate, visible -3-unit discrepancy (see oversoldValueCents below).
export function flooredInventoryValueCents(
  stockQuantities: number[],
  unitValueCents: number[]
): number {
  return stockQuantities.reduce(
    (sum, quantity, i) => sum + Math.max(quantity, 0) * unitValueCents[i],
    0
  );
}

// The un-floored discrepancy that flooring excludes (always <= 0): what
// flooredInventoryValueCents leaves out, surfaced separately rather than
// silently vanishing.
export function oversoldValueCents(stockQuantities: number[], unitValueCents: number[]): number {
  return stockQuantities.reduce(
    (sum, quantity, i) => sum + Math.min(quantity, 0) * unitValueCents[i],
    0
  );
}
