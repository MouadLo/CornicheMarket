// Loyalty points arithmetic, the device's mirror of record_sale. Money is
// integer centimes, points are integers. The server decides what is really
// earned; the device uses this to show it and to cap a redemption.

export type LoyaltyRates = {
  centsPerPoint: number; // 1000: 1 point per full 10.00 DH
  pointValueCents: number; // 10: 1 point = 0.10 DH, 100 points = 10.00 DH
  minRedeemPoints: number; // 100
};

export const DEFAULT_RATES: LoyaltyRates = {
  centsPerPoint: 1000,
  pointValueCents: 10,
  minRedeemPoints: 100,
};

// Points for an amount paid on eligible items: full steps only.
export function pointsEarned(eligiblePaidCents: number, rates: LoyaltyRates): number {
  if (!(eligiblePaidCents > 0) || !(rates.centsPerPoint > 0)) return 0;
  return Math.floor(eligiblePaidCents / rates.centsPerPoint);
}

export function pointsValueCents(points: number, rates: LoyaltyRates): number {
  return Math.max(0, Math.trunc(points)) * rates.pointValueCents;
}

// The most points this basket can take: no more than the balance, and their
// value no more than what the eligible items cost (points never pay for
// excluded items). 0 when that is below the minimum.
export function maxRedeemablePoints(
  balance: number,
  eligibleCents: number,
  rates: LoyaltyRates
): number {
  if (!(rates.pointValueCents > 0)) return 0;
  const byValue = Math.floor(Math.max(0, eligibleCents) / rates.pointValueCents);
  const max = Math.min(Math.max(0, Math.trunc(balance)), byValue);
  return max >= rates.minRedeemPoints ? max : 0;
}

// Bonus points of one line: per whole unit sold (2.4 kg earns 2 bonuses, 0.75 kg
// none), and never on an excluded product. Same rule as the server.
export function lineBonusPoints(line: {
  quantity: number;
  eligible: boolean;
  bonusPerUnit: number;
}): number {
  if (!line.eligible || !(line.bonusPerUnit > 0) || !(line.quantity > 0)) return 0;
  return Math.floor(line.quantity + 1e-9) * Math.trunc(line.bonusPerUnit);
}

export type EarnLine = {
  totalCents: number; // after the line's own discount
  eligible: boolean;
  quantity?: number;
  bonusPerUnit?: number;
};

// What a basket is expected to earn when it is paid: base points on eligible
// lines after their own discounts, minus their share of the sale discount
// (which includes the points spent), spread like the server does it
// (proportionally); plus the products' bonus points.
export function expectedEarn(
  lines: EarnLine[],
  saleDiscountCents: number,
  rates: LoyaltyRates
): { base: number; bonus: number; total: number } {
  const bonus = lines.reduce(
    (sum, line) =>
      sum +
      lineBonusPoints({
        quantity: line.quantity ?? 0,
        eligible: line.eligible,
        bonusPerUnit: line.bonusPerUnit ?? 0,
      }),
    0
  );
  const total = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const eligible = lines.reduce((sum, line) => sum + (line.eligible ? line.totalCents : 0), 0);
  let base = 0;
  if (total > 0 && eligible > 0) {
    const share = Math.floor((Math.min(saleDiscountCents, total) * eligible) / total);
    base = pointsEarned(eligible - share, rates);
  }
  return { base, bonus, total: base + bonus };
}

export const REDEEM_STEP = 10;

// One tap of the stepper: up goes `step` points at a time, never above `max`;
// down goes `step` points, and below the minimum it drops to 0 (no points). From
// 0 the first tap up lands on the minimum. `max` is 0 when nothing can be spent.
export function stepRedeemPoints(
  current: number,
  direction: "up" | "down",
  max: number,
  rates: Pick<LoyaltyRates, "minRedeemPoints">,
  step: number = REDEEM_STEP
): number {
  if (!(max > 0)) return 0;
  const min = Math.min(rates.minRedeemPoints, max);
  const now = Math.min(Math.max(0, Math.trunc(current)), max);
  if (direction === "up") return now < min ? min : Math.min(max, now + step);
  const next = now - step;
  return next < min ? 0 : next;
}
