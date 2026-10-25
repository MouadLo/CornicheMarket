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

export function totalItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
