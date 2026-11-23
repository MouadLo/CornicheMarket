import {
  decide,
  percentToBp,
  type CompetitorOffer,
  type Decision,
} from "@/src/lib/competitors/pricing";

// One row of competitor_price_overview(): a link of a product with its latest reading.
export type OverviewRow = {
  product_id: string;
  product_name: string;
  unit: "piece" | "kg" | "pack";
  selling_price_cents: number;
  cost_cents: number | null;
  min_margin_percent: number | string;
  margin_override: number | string | null;
  link_id: string;
  shop_name: string;
  url: string;
  mode: "auto" | "manual";
  last_status: string | null;
  last_status_detail: string | null;
  last_checked_at: string | null;
  last_ok_at: string | null;
  price_cents: number | null;
  regular_price_cents: number | null;
  on_sale: boolean | null;
  in_stock: boolean | null;
  low_stock_remaining: number | null;
  title: string | null;
  image_url: string | null;
  observed_at: string | null;
};

export type ProductComparison = {
  productId: string;
  name: string;
  unit: "piece" | "kg" | "pack";
  sellingPriceCents: number;
  costCents: number | null;
  minMarginBp: number;
  offers: CompetitorOffer[];
  decision: Decision;
  // True when a link is out of stock (for the "Concurrent en rupture" filter).
  anyOutOfStock: boolean;
};

export function offerFromRow(row: OverviewRow): CompetitorOffer {
  return {
    linkId: row.link_id,
    shopName: row.shop_name,
    priceCents: row.price_cents,
    regularPriceCents: row.regular_price_cents,
    onSale: row.on_sale === true,
    // A link never read has no point yet: nothing usable, not "in stock".
    inStock: row.in_stock === true,
    checkedAt: row.last_ok_at,
  };
}

// Groups the link rows by product (the RPC already orders them by name) and
// runs the pricing decision for each product.
export function compareProducts(rows: OverviewRow[], now: number): ProductComparison[] {
  const byProduct = new Map<string, ProductComparison>();
  for (const row of rows) {
    let entry = byProduct.get(row.product_id);
    if (!entry) {
      entry = {
        productId: row.product_id,
        name: row.product_name,
        unit: row.unit,
        sellingPriceCents: Number(row.selling_price_cents),
        costCents: row.cost_cents === null ? null : Number(row.cost_cents),
        minMarginBp: percentToBp(row.min_margin_percent),
        offers: [],
        decision: null as unknown as Decision,
        anyOutOfStock: false,
      };
      byProduct.set(row.product_id, entry);
    }
    const offer = offerFromRow(row);
    entry.offers.push(offer);
    if (row.in_stock === false) entry.anyOutOfStock = true;
  }
  const result = [...byProduct.values()];
  for (const entry of result) {
    entry.decision = decide({
      sellingPriceCents: entry.sellingPriceCents,
      costCents: entry.costCents,
      minMarginBp: entry.minMarginBp,
      offers: entry.offers,
      now,
    });
  }
  return result;
}
