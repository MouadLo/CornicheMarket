// Two ways to use the competitor prices beyond "follow them down":
//  - price-check products ("produits repères"): customers know these prices, so
//    we must not be dearer than the competitor on them;
//  - money on the table: products where we are cheaper, so a small raise keeps
//    us cheaper and earns more.
// Pure integer math in centimes; the quantity sold may be decimal (kg), which
// lineTotalCents already rounds once.

import { lineTotalCents } from "@/src/lib/money";
import type { ProductComparison } from "@/src/lib/competitors/overview";
import { RAISE_UNDERCUT_CENTS } from "@/src/lib/competitors/pricing";

export type PriceCheckAlert = {
  comparison: ProductComparison;
  // Our price minus theirs (> 0).
  gapCents: number;
  // How much dearer we are than the competitor, in basis points of THEIR
  // price (1 bp = 0.01 %).
  gapBp: number;
  // "apply": move to `suggestedCents`. "below_cost": their price is under our
  // cost, nothing to apply (talk to the supplier). "none": no usable suggestion
  // (already at the margin floor).
  action: "apply" | "below_cost" | "none";
  suggestedCents: number | null;
};

// How much dearer than `theirs` we are, in basis points of their price, rounded
// half up. Integer math only.
function gapBpOf(gapCents: number, theirs: number): number {
  return Math.floor((2 * gapCents * 10000 + theirs) / (2 * theirs));
}

// Tagged products where we are dearer than a relevant competitor offer, the
// biggest gap (in percent of their price) first.
export function priceCheckAlerts(comparisons: ProductComparison[]): PriceCheckAlert[] {
  const alerts: PriceCheckAlert[] = [];
  for (const comparison of comparisons) {
    if (!comparison.priceCheck) continue;
    const { decision } = comparison;
    const theirs = decision.offer?.priceCents ?? null;
    if (theirs === null || theirs <= 0 || decision.gapCents === null || decision.gapCents <= 0) {
      continue;
    }
    const belowCost = decision.outcome === "dont_follow";
    const canApply =
      (decision.outcome === "lower" || decision.outcome === "floor") &&
      decision.suggestedCents !== null;
    alerts.push({
      comparison,
      gapCents: decision.gapCents,
      gapBp: gapBpOf(decision.gapCents, theirs),
      action: belowCost ? "below_cost" : canApply ? "apply" : "none",
      suggestedCents: canApply ? decision.suggestedCents : null,
    });
  }
  return alerts.sort(
    (a, b) => b.gapBp - a.gapBp || a.comparison.name.localeCompare(b.comparison.name)
  );
}

// Untagged products a competitor sells (relevant offer) that we do sell: the
// best sellers first, as candidates to tag.
export function suggestPriceCheck(
  comparisons: ProductComparison[],
  limit = 10
): ProductComparison[] {
  return comparisons
    .filter((c) => !c.priceCheck && c.decision.offer !== null && c.sold30d > 0)
    .sort((a, b) => b.sold30d - a.sold30d || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

export type MoneyOnTheTable = {
  comparison: ProductComparison;
  // Their cheapest relevant price and the price we would move to.
  theirsCents: number;
  targetCents: number;
  perUnitGainCents: number;
  monthlyGainCents: number;
};

export type MoneyOnTheTableResult = {
  items: MoneyOnTheTable[];
  totalMonthlyGainCents: number;
  // Cheaper products with no sale in the last 30 days (no gain to rank).
  noSalesCount: number;
};

// Products where target = their price - 0.50 DH is above ours, ranked by the
// gain per month (units sold in 30 days x gain per unit). No cost needed.
export function moneyOnTheTable(comparisons: ProductComparison[]): MoneyOnTheTableResult {
  const items: MoneyOnTheTable[] = [];
  let noSalesCount = 0;
  for (const comparison of comparisons) {
    const theirs = comparison.decision.offer?.priceCents ?? null;
    if (theirs === null || theirs <= 0) continue;
    const target = theirs - RAISE_UNDERCUT_CENTS;
    const perUnit = target - comparison.sellingPriceCents;
    if (perUnit <= 0) continue;
    if (!(comparison.sold30d > 0)) {
      noSalesCount += 1;
      continue;
    }
    items.push({
      comparison,
      theirsCents: theirs,
      targetCents: target,
      perUnitGainCents: perUnit,
      monthlyGainCents: lineTotalCents(comparison.sold30d, perUnit),
    });
  }
  items.sort(
    (a, b) =>
      b.monthlyGainCents - a.monthlyGainCents || a.comparison.name.localeCompare(b.comparison.name)
  );
  return {
    items,
    totalMonthlyGainCents: items.reduce((sum, item) => sum + item.monthlyGainCents, 0),
    noSalesCount,
  };
}
