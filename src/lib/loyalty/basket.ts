// What a basket earns and what points may pay for, from the lines on screen.
// The device's mirror of the server's stamps (sale_items.loyalty_eligible and
// loyalty_bonus_per_unit): the server decides, this shows and caps.
import type { EarnLine } from "@/src/lib/loyalty/points";
import { lineTotal, type CartLine } from "@/src/lib/sales/totals";

// The categories whose products earn nothing: the excluded ones and, as on the
// server, the sub-categories of an excluded main category.
export function effectiveExcludedCategoryIds(
  categories: { id: string; parent_id: string | null; loyalty_excluded: boolean }[]
): string[] {
  const excluded = new Set(categories.filter((c) => c.loyalty_excluded).map((c) => c.id));
  return categories
    .filter((c) => excluded.has(c.id) || (c.parent_id !== null && excluded.has(c.parent_id)))
    .map((c) => c.id);
}

// Divers, an excluded product and a product of an excluded category earn
// nothing and cannot be paid with points. A line the device knows nothing about
// is read as eligible (the server still judges).
export function lineEligible(
  line: Pick<CartLine, "loyalty">,
  excludedCategories: ReadonlySet<string>
): boolean {
  const info = line.loyalty;
  if (!info) return true;
  if (info.misc || info.excluded) return false;
  return !(info.category_id && excludedCategories.has(info.category_id));
}

// Bonus points per unit while the promo is on (no end, or an end in the future).
export function lineBonusPerUnit(line: Pick<CartLine, "loyalty">, now: number): number {
  const info = line.loyalty;
  if (!info || !(info.bonus > 0)) return 0;
  if (info.bonus_until !== null) {
    const until = Date.parse(info.bonus_until);
    if (Number.isFinite(until) && until <= now) return 0;
  }
  return info.bonus;
}

export function earnLinesOf(
  lines: CartLine[],
  excludedCategories: ReadonlySet<string>,
  now: number
): EarnLine[] {
  return lines.map((line) => ({
    totalCents: lineTotal(line),
    eligible: lineEligible(line, excludedCategories),
    quantity: line.quantity,
    bonusPerUnit: lineBonusPerUnit(line, now),
  }));
}

// What points may pay for, in centimes. Points are recorded as part of the sale
// discount, and the server spreads a sale discount over the lines that accept
// one (the discountable lines, or every line when none is: sale_line_economics).
// So points may only pay for lines that both earn points and take that
// discount, and never more than those lines have left once the manual sale
// discount is spread. Otherwise a line's share would go negative and a return
// would refund money that was paid with points.
export function eligibleCentsOf(
  lines: CartLine[],
  excludedCategories: ReadonlySet<string>,
  manualSaleDiscountCents = 0
): number {
  const anyDiscountable = lines.some((line) => line.discountable !== false);
  const inBase = (line: CartLine) => !anyDiscountable || line.discountable !== false;
  const baseCents = lines.reduce((sum, line) => (inBase(line) ? sum + lineTotal(line) : sum), 0);
  const payable = lines.reduce(
    (sum, line) =>
      inBase(line) && lineEligible(line, excludedCategories) ? sum + lineTotal(line) : sum,
    0
  );
  return Math.max(0, Math.min(payable, baseCents - Math.max(0, manualSaleDiscountCents)));
}
