// TypeScript mirror of the arithmetic in the report SQL functions. Keeping
// it here lets the same hand-worked examples be asserted in tests, so a
// change to either side shows up as a failure rather than a wrong number
// on screen.

// A basket discount belongs to the sale, not to any line, so it is split
// across lines in proportion to their value. Mirrors sale_line_economics.
export function allocateSaleDiscount(
  lineTotalsCents: number[],
  saleDiscountCents: number
): number[] {
  const total = lineTotalsCents.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || saleDiscountCents <= 0) {
    return lineTotalsCents.map(() => 0);
  }
  return lineTotalsCents.map((lineTotal) =>
    Math.round((saleDiscountCents * lineTotal) / total)
  );
}

export function netLineRevenue(
  lineTotalsCents: number[],
  saleDiscountCents: number
): number[] {
  const allocated = allocateSaleDiscount(lineTotalsCents, saleDiscountCents);
  return lineTotalsCents.map((lineTotal, index) => lineTotal - allocated[index]);
}

export function averageBasketCents(revenueCents: number, transactionCount: number): number {
  if (transactionCount <= 0) return 0;
  return Math.round(revenueCents / transactionCount);
}

export function grossMarginPercent(
  revenueCents: number,
  cogsCents: number
): number | null {
  if (revenueCents <= 0) return null;
  return ((revenueCents - cogsCents) / revenueCents) * 100;
}

export function inventoryPotentialProfitCents(
  retailValueCents: number,
  costValueCents: number
): number {
  return retailValueCents - costValueCents;
}
