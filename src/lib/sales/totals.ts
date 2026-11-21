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
  // Whether a cashier may discount this item (stamped by the server on the
  // sale; here it only drives the cashier's limit). A basket saved before this
  // field existed has it missing, which is read as true (see basketStore).
  discountable: boolean;
  // What the device needs to estimate loyalty points for this line (never sent
  // to the server: it stamps its own copy). Absent on a line built before
  // loyalty existed, or from a product the device holds no loyalty data for;
  // such a line is read as eligible with no bonus.
  loyalty?: LineLoyalty;
};

export type LineLoyalty = {
  category_id: string | null;
  // The product's own exclusion (Divers is never eligible, see `misc`).
  excluded: boolean;
  // Bonus points per whole unit while the promo runs.
  bonus: number;
  // The instant the bonus ends (null = no end).
  bonus_until: string | null;
  // The free-amount Divers item.
  misc: boolean;
};

// The one place a cart line is built from a product. The Sell screen and the
// tests both use it, and a product from the offline cache has no cost field.
export function cartLineFrom(
  product: {
    id: string;
    name: string;
    unit: string;
    selling_price_cents: number;
    current_cost_cents?: number | null;
    // Missing on a product the device cached before this field existed.
    discountable?: boolean | null;
    category_id?: string | null;
    // Loyalty fields (migration 048); missing on rows from an older cache.
    loyalty_excluded?: boolean;
    loyalty_bonus_points?: number;
    loyalty_bonus_until?: string | null;
    kind?: string;
  },
  quantity: number
): CartLine {
  const hasLoyalty =
    product.loyalty_excluded !== undefined ||
    product.loyalty_bonus_points !== undefined ||
    product.kind === "misc";
  return {
    product_id: product.id,
    name: product.name,
    unit: product.unit,
    quantity,
    unit_price_cents: product.selling_price_cents,
    discount_cents: 0,
    unit_cost_cents: product.current_cost_cents ?? null,
    discountable: product.discountable ?? true,
    ...(hasLoyalty
      ? {
          loyalty: {
            category_id: product.category_id ?? null,
            excluded: product.loyalty_excluded === true,
            bonus: Math.max(0, Math.trunc(product.loyalty_bonus_points ?? 0)),
            bonus_until: product.loyalty_bonus_until ?? null,
            misc: product.kind === "misc",
          },
        }
      : {}),
  };
}

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

// What the customer is charged: the manual sale discount and the value of the
// points they spend are both taken off the basket. Only the manual part is
// ever checked against the cashier's discount limit (points are the customer's
// own money, not a favour of the cashier).
export function saleTotalWithPoints(
  lines: CartLine[],
  manualDiscountCents: number,
  pointsValueCents: number
): number {
  return saleTotal(lines, Math.max(0, manualDiscountCents) + Math.max(0, pointsValueCents));
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
