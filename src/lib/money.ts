// All money is stored and computed as integer centimes (MAD cents) to
// avoid floating-point drift. Only format to decimal MAD at the UI edge.

export function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function displayToCents(value: string): number {
  return Math.round(parseFloat(value) * 100);
}

export function formatMAD(cents: number): string {
  return `${centsToDisplay(cents)} DH`;
}

// "3 482.50 DH": thousands grouped with a narrow no-break space so long
// totals are readable at a glance. Used by <Money>; formatMAD stays as is
// for exports, messages and screens that have not moved to <Money> yet.
export function formatMADGrouped(cents: number): string {
  const negative = cents < 0;
  const [whole, fraction] = centsToDisplay(Math.abs(cents)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  return `${negative ? "\u2212" : ""}${grouped}.${fraction} DH`;
}

// Mirrors the `apply_purchase_item` SQL trigger: the new weighted-average
// cost after receiving `boughtQty` units at `boughtCostCents` each.
export function weightedAverageCost(
  oldQty: number,
  oldCostCents: number,
  boughtQty: number,
  boughtCostCents: number
): number {
  if (oldQty <= 0) {
    return boughtCostCents;
  }
  return Math.round((oldQty * oldCostCents + boughtQty * boughtCostCents) / (oldQty + boughtQty));
}

export function lineTotalCents(
  quantity: number,
  unitPriceCents: number,
  discountCents = 0
): number {
  return Math.round(quantity * unitPriceCents) - discountCents;
}

export function profitCents(
  unitPriceCents: number,
  unitCostCents: number,
  quantity: number
): number {
  return Math.round((unitPriceCents - unitCostCents) * quantity);
}

// Gross margin on the selling price. Null means "can't say": a product with
// no cost yet (never purchased) would otherwise show a misleading 100%.
export function marginPercent(sellingPriceCents: number, costCents: number): number | null {
  if (costCents <= 0 || sellingPriceCents <= 0) return null;
  return ((sellingPriceCents - costCents) / sellingPriceCents) * 100;
}

export function formatMargin(margin: number | null): string {
  return margin === null ? "—" : `${margin.toFixed(1)}%`;
}

// Mirrors the bulk_adjust_selling_price SQL function.
export function applyPercent(priceCents: number, percent: number): number {
  return Math.max(0, Math.round(priceCents * (1 + percent / 100)));
}

// CSV comes from Excel/Sheets in whatever locale the supplier used, so
// "1 234,56", "1,234.56" and "12.50" all have to land on the same number.
// This only normalizes the text; money and quantities round differently.
function parseLocaleDecimal(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, "").replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;

  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

// Money: integer centimes.
export function parseMoneyToCents(raw: string): number | null {
  const value = parseLocaleDecimal(raw);
  return value === null ? null : Math.round(value * 100);
}

// Quantities: stock_quantity and sale_items.quantity are numeric(12,3), so
// a weight is kept to the gram (0.125 kg stays 0.125). Never route a
// quantity through cents -- that rounds it to 2 decimals.
export function parseQuantity(raw: string): number | null {
  const value = parseLocaleDecimal(raw);
  return value === null ? null : Math.round(value * 1000) / 1000;
}
