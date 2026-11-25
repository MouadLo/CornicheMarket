// The margin a site price leaves on the app product it is linked to. Pure
// integer math in centimes and basis points (1 bp = 0.01 %). The minimum is the
// same one the competitor prices use (see fetchProductMarginInfo).
import { floorPriceCents, marginBp, percentToBp } from "@/src/lib/competitors/pricing";

export type PriceMarginLevel = "ok" | "low" | "loss" | "unknown";

export type PriceMarginCheck = {
  level: PriceMarginLevel;
  // (price - cost) / price, rounded; null when the cost is unknown.
  marginBp: number | null;
  // The lowest price that keeps the minimum margin (rounded up to 0.50 DH);
  // null when the cost is unknown.
  minPriceCents: number | null;
};

export type PriceMarginInput = {
  newPriceCents: number;
  // The weighted-average cost; null or 0 = no cost recorded.
  costCents: number | null;
  minMarginBp: number;
};

// "unknown" never blocks: a product without a recorded cost cannot be checked.
export function checkSitePriceMargin(input: PriceMarginInput): PriceMarginCheck {
  const { newPriceCents, costCents, minMarginBp } = input;
  if (costCents === null || costCents <= 0) {
    return { level: "unknown", marginBp: null, minPriceCents: null };
  }
  const margin = marginBp(newPriceCents, costCents);
  const minPriceCents = floorPriceCents(costCents, minMarginBp);
  if (newPriceCents <= costCents) return { level: "loss", marginBp: margin, minPriceCents };
  // Exact comparison (no rounded margin): (price - cost) / price >= min.
  const enough = (newPriceCents - costCents) * 10000 >= minMarginBp * newPriceCents;
  return { level: enough ? "ok" : "low", marginBp: margin, minPriceCents };
}

// The minimum margin that applies to a product: its own override, else the
// store-wide one (both in percent, as stored).
export function minMarginBpFor(overridePercent: number | null, storePercent: number): number {
  return percentToBp(overridePercent ?? storePercent);
}
