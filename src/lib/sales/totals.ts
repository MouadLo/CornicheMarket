// Every amount here is integer centimes. Quantities may be fractional for
// kg items, so each line is rounded once, at the line, before summing.

export type CartLine = {
  product_id: string;
  name: string;
  unit: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  // Only known to owners; null for cashiers, who never receive cost data.
  unit_cost_cents: number | null;
};

export function lineSubtotal(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

export function lineTotal(line: CartLine): number {
  return Math.max(0, lineSubtotal(line.quantity, line.unit_price_cents) - line.discount_cents);
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function saleTotal(lines: CartLine[], saleDiscountCents: number): number {
  return Math.max(0, cartSubtotal(lines) - Math.max(0, saleDiscountCents));
}

export function changeDue(tenderedCents: number, totalCents: number): number {
  return Math.max(0, tenderedCents - totalCents);
}

export function isShortPayment(tenderedCents: number, totalCents: number): boolean {
  return tenderedCents < totalCents;
}

export function costOfGoods(lines: CartLine[]): number | null {
  if (lines.some((line) => line.unit_cost_cents === null)) return null;
  return lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * (line.unit_cost_cents as number)),
    0
  );
}

// Profit is what the sale actually brought in minus what the goods cost, so
// a sale-level discount reduces profit exactly once.
export function saleProfit(lines: CartLine[], saleDiscountCents: number): number | null {
  const cogs = costOfGoods(lines);
  if (cogs === null) return null;
  return saleTotal(lines, saleDiscountCents) - cogs;
}

// record_sale rejects any line with quantity <= 0 (sale_items CHECK), and a
// sale rejected there lands in the offline queue's quarantine. An emptied or
// zero kg field must therefore stop the sale at the counter, not later.
export function hasInvalidQuantity(lines: CartLine[]): boolean {
  return lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0);
}

export function totalItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

// A discount bigger than what it discounts is a data-entry error, not a
// legitimate markdown. Catching it here means it never reaches the point of
// being silently clamped to a misleading 0.00 on screen, and never reaches
// the DB CHECK on line_total_cents that would otherwise roll back (and, via
// the offline queue's error classifier, quarantine) the whole sale.
export function isLineDiscountValid(
  quantity: number,
  unitPriceCents: number,
  discountCents: number
): boolean {
  return discountCents >= 0 && discountCents <= lineSubtotal(quantity, unitPriceCents);
}

// Mirrors the same rule at the basket level: a sale-wide discount cannot
// exceed what the basket (after any line discounts) actually comes to.
export function isSaleDiscountValid(lines: CartLine[], saleDiscountCents: number): boolean {
  return saleDiscountCents >= 0 && saleDiscountCents <= cartSubtotal(lines);
}

export type DiscountValidationError = "line" | "sale" | null;

// The single gate a sale must pass before it is ever handed to
// enqueueSale. Called from handleConfirm so an invalid discount is
// rejected with a readable error right there -- it never becomes a
// PendingSale, so it can never end up in the offline queue's retry/
// quarantine pipeline at all.
export function validateSaleDiscounts(
  lines: CartLine[],
  saleDiscountCents: number
): DiscountValidationError {
  const hasInvalidLine = lines.some(
    (line) => !isLineDiscountValid(line.quantity, line.unit_price_cents, line.discount_cents)
  );
  if (hasInvalidLine) return "line";
  if (!isSaleDiscountValid(lines, saleDiscountCents)) return "sale";
  return null;
}
