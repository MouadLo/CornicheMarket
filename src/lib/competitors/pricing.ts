// The pricing decision for one product against its competitors' prices.
// Owner only: it needs the product's unit cost. Pure integer math in centimes
// and basis points (1 bp = 0.01 %); no float ever touches a price.

export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
// Suggested prices are rounded UP to the next 0.50 DH, so a floor is never broken.
export const PRICE_STEP_CENTS = 50;
// "We are cheaper by more than 10 %" (of the competitor's price) suggests a raise.
export const RAISE_THRESHOLD_BP = 1000;
// A raise goes to just under the competitor: competitor price minus 0.50 DH.
export const RAISE_UNDERCUT_CENTS = 50;

export type CompetitorOffer = {
  linkId: string;
  shopName: string;
  // Null when the shop shows no price (typically out of stock).
  priceCents: number | null;
  regularPriceCents: number | null;
  onSale: boolean;
  inStock: boolean;
  // When a price was last read or typed (ISO). Null = never.
  checkedAt: string | null;
};

export type Outcome =
  "ok" | "lower" | "floor" | "dont_follow" | "could_raise" | "no_data" | "no_cost";

export type Decision = {
  outcome: Outcome;
  // The price to apply, or null when there is nothing to suggest.
  suggestedCents: number | null;
  currentMarginBp: number | null;
  // Margin if we sold at the competitor's price.
  marginIfMatchedBp: number | null;
  // Our price minus the competitor's: positive = the competitor is cheaper.
  gapCents: number | null;
  offer: CompetitorOffer | null;
  promo: boolean;
};

export type DecisionInput = {
  sellingPriceCents: number;
  // The weighted-average unit cost; null or 0 = unknown.
  costCents: number | null;
  // Minimum margin to keep, in basis points (15 % = 1500).
  minMarginBp: number;
  offers: CompetitorOffer[];
  now: number;
};

// Integer division rounded half up (non-negative divisor).
function roundDiv(numerator: number, divisor: number): number {
  return Math.floor((2 * numerator + divisor) / (2 * divisor));
}

// (price - cost) / price in basis points; null for a zero price.
export function marginBp(priceCents: number, costCents: number): number | null {
  if (priceCents <= 0) return null;
  return roundDiv((priceCents - costCents) * 10000, priceCents);
}

// "15", "15.5", 15 -> 1500, 1550. Percent is not money, so a plain rounding is fine.
export function percentToBp(percent: number | string): number {
  const value = typeof percent === "string" ? Number(percent) : percent;
  return Math.round(value * 100);
}

export function bpToPercentText(bp: number): string {
  const whole = Math.floor(bp / 100);
  const fraction = bp % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

// The lowest price that keeps `minMarginBp`, rounded up to the next 0.50 DH.
// price >= cost / (1 - floor); the exact ceiling is taken before the rounding.
export function floorPriceCents(costCents: number, minMarginBp: number): number {
  const exact = Math.ceil((costCents * 10000) / (10000 - minMarginBp));
  return Math.ceil(exact / PRICE_STEP_CENTS) * PRICE_STEP_CENTS;
}

export function isFresh(checkedAt: string | null, now: number): boolean {
  if (!checkedAt) return false;
  const time = Date.parse(checkedAt);
  return Number.isFinite(time) && now - time <= STALE_AFTER_MS;
}

// A price counts when the shop has it in stock, shows a price, and it was
// checked (automatically or by hand) in the last 7 days.
export function isRelevant(offer: CompetitorOffer, now: number): boolean {
  return (
    offer.inStock &&
    offer.priceCents !== null &&
    offer.priceCents > 0 &&
    isFresh(offer.checkedAt, now)
  );
}

// The cheapest relevant offer; on a tie the most recently checked one.
export function cheapestRelevant(offers: CompetitorOffer[], now: number): CompetitorOffer | null {
  let best: CompetitorOffer | null = null;
  for (const offer of offers) {
    if (!isRelevant(offer, now)) continue;
    if (
      !best ||
      (offer.priceCents as number) < (best.priceCents as number) ||
      (offer.priceCents === best.priceCents &&
        Date.parse(offer.checkedAt as string) > Date.parse(best.checkedAt as string))
    ) {
      best = offer;
    }
  }
  return best;
}

export function decide(input: DecisionInput): Decision {
  const { sellingPriceCents: ours, minMarginBp, now } = input;
  const cost = input.costCents !== null && input.costCents > 0 ? input.costCents : null;
  const offer = cheapestRelevant(input.offers, now);
  const base: Decision = {
    outcome: "no_data",
    suggestedCents: null,
    currentMarginBp: cost === null ? null : marginBp(ours, cost),
    marginIfMatchedBp: null,
    gapCents: null,
    offer,
    promo: false,
  };
  if (!offer) return base;

  const theirs = offer.priceCents as number;
  const withOffer: Decision = {
    ...base,
    gapCents: ours - theirs,
    marginIfMatchedBp: cost === null ? null : marginBp(theirs, cost),
    promo: offer.onSale,
  };
  if (cost === null) return { ...withOffer, outcome: "no_cost" };

  if (theirs >= ours) {
    // We are cheaper or equal. More than 10 % cheaper: room to raise.
    const gap = theirs - ours;
    if (gap * 10000 > RAISE_THRESHOLD_BP * theirs) {
      const raised = theirs - RAISE_UNDERCUT_CENTS;
      if (raised > ours) return { ...withOffer, outcome: "could_raise", suggestedCents: raised };
    }
    return { ...withOffer, outcome: "ok" };
  }

  if (theirs < cost) return { ...withOffer, outcome: "dont_follow" };

  // Matching keeps the floor when (theirs - cost) / theirs >= floor.
  if ((theirs - cost) * 10000 >= minMarginBp * theirs) {
    return { ...withOffer, outcome: "lower", suggestedCents: theirs };
  }

  const lowest = floorPriceCents(cost, minMarginBp);
  return {
    ...withOffer,
    outcome: "floor",
    // Only when it actually lowers our price; otherwise we are already at the floor.
    suggestedCents: lowest < ours ? lowest : null,
  };
}

// Outcomes the owner should look at (a price change is on offer).
export function needsReview(decision: Decision): boolean {
  return (
    decision.suggestedCents !== null &&
    (decision.outcome === "lower" ||
      decision.outcome === "floor" ||
      decision.outcome === "could_raise")
  );
}

// "3333" -> "33.3": one decimal for display. A percentage, not money.
export function bpToDisplay(bp: number): string {
  return (Math.round(bp / 10) / 10).toFixed(1);
}

// How much cheaper than the competitor we are, in whole percent of their price.
export function cheaperPercent(oursCents: number, theirsCents: number): number {
  return theirsCents > 0 ? roundDiv((theirsCents - oursCents) * 100, theirsCents) : 0;
}
