// The latest stored reading of a link, as far as change detection needs it.
export type StoredPoint = {
  price_cents: number | null;
  regular_price_cents: number | null;
  in_stock: boolean;
};

// What check-competitor-prices answers.
export type CheckResult = {
  status: "ok" | "refused" | "unsupported" | "error" | "manual" | "rate_limited";
  detail?: string;
  skipped?: boolean;
  retryAfterSeconds?: number;
  reading?: {
    title: string | null;
    priceCents: number | null;
    regularPriceCents: number | null;
    onSale: boolean;
    inStock: boolean;
    lowStockRemaining: number | null;
    imageUrl: string | null;
  };
};
