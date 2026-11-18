// Which warning, if any, to show before saving a product's selling price.
// Pure: the form turns the answer into a confirmation dialog.
//
// "zero" wins over "below-cost" (a free product is also below cost, but the
// zero message is the clearer one). The cost is the owner-only
// current_cost_cents: null for cashiers, and 0 or less means no buying price
// is known yet, so no comparison is made.
export type PriceWarning =
  { kind: "zero" } | { kind: "below-cost"; priceCents: number; costCents: number } | null;

export function priceWarning(priceCents: number, costCents: number | null): PriceWarning {
  if (priceCents === 0) return { kind: "zero" };
  if (costCents !== null && costCents > 0 && priceCents < costCents) {
    return { kind: "below-cost", priceCents, costCents };
  }
  return null;
}
