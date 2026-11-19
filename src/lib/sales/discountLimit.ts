// The cashier discount limit. The device enforces it (it must work offline);
// the server never rejects a sale for it, it only flags it for the owner.
// Every amount is integer centimes. A percent such as 7.5 is turned into
// hundredths of a percent first, so no float ever multiplies a price.
import { lineSubtotal, type CartLine } from "@/src/lib/sales/totals";

export type DiscountLimits = { percent: number; maxCents: number };

export const DEFAULT_DISCOUNT_LIMITS: DiscountLimits = { percent: 5, maxCents: 2000 };

export type DiscountOverride = "allow" | "block" | null;

function hundredths(percent: number): number {
  return Math.round(percent * 100);
}

// What a cashier may give on this basket: percent of the items that allow a
// discount (before any discount), never more than the per-sale maximum.
export function cashierDiscountLimitCents(
  lines: Pick<CartLine, "quantity" | "unit_price_cents" | "discountable">[],
  limits: DiscountLimits
): number {
  const gross = lines.reduce(
    (sum, line) =>
      line.discountable ? sum + lineSubtotal(line.quantity, line.unit_price_cents) : sum,
    0
  );
  const byPercent = Math.floor(Math.round(hundredths(limits.percent) * gross) / 10000);
  return Math.max(0, Math.min(byPercent, limits.maxCents));
}

export type CashierDiscountProblem =
  { kind: "blocked"; lineIds: string[] } | { kind: "over"; limitCents: number; totalCents: number };

// null when the discounts (line discounts + the sale discount together) are
// within what a cashier may give.
export function cashierDiscountProblem(
  lines: CartLine[],
  saleDiscountCents: number,
  limits: DiscountLimits
): CashierDiscountProblem | null {
  const blocked = lines.filter((line) => !line.discountable && line.discount_cents > 0);
  if (blocked.length > 0) {
    return { kind: "blocked", lineIds: blocked.map((line) => line.product_id) };
  }
  const totalCents =
    lines.reduce((sum, line) => sum + Math.max(0, line.discount_cents), 0) +
    Math.max(0, saleDiscountCents);
  const limitCents = cashierDiscountLimitCents(lines, limits);
  if (totalCents > limitCents) return { kind: "over", limitCents, totalCents };
  return null;
}

// What is left of the allowance after the line discounts: what the sale
// discount field may still hold.
export function remainingSaleDiscountCents(lines: CartLine[], limits: DiscountLimits): number {
  const used = lines.reduce((sum, line) => sum + Math.max(0, line.discount_cents), 0);
  return Math.max(0, cashierDiscountLimitCents(lines, limits) - used);
}

// Mirrors the database rule for `discountable`, without the owner's override.
// A Divers item has no real cost on screen: its margin is the owner's estimate.
export function autoDiscountable(
  product: { priceCents: number; costCents: number | null; kind?: string },
  limits: DiscountLimits,
  diversMarginPercent?: number
): boolean {
  if (product.priceCents <= 0) return false;
  if (product.kind === "divers") {
    return diversMarginPercent !== undefined && diversMarginPercent >= limits.percent;
  }
  if (product.costCents === null || product.costCents <= 0) return false;
  return (
    (product.priceCents - product.costCents) * 10000 >=
    hundredths(limits.percent) * product.priceCents
  );
}

export function effectiveDiscountable(override: DiscountOverride, auto: boolean): boolean {
  if (override === "allow") return true;
  if (override === "block") return false;
  return auto;
}
