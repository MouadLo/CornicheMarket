// Pure helpers for the competitor shop screens (À confirmer, Vous ne l'avez pas,
// À sourcer, Boutiques). Money is integer centimes; display goes through formatMAD.
import { centsToDisplay, formatMAD } from "@/src/lib/money";

export const PAGE_SIZE = 30;
export const NOTE_MAX = 300;

export type CatalogView = "proposed" | "missing" | "wanted";
export type MissingSort = "popularity" | "price_asc" | "price_desc" | "newest";
export type SourcingStatus = "to_ask" | "asked" | "found";

// A row of competitor_catalog_page().
export type CatalogRow = {
  id: string;
  shop_id: string;
  shop_name: string;
  name: string;
  url: string;
  price_cents: number | null;
  regular_price_cents: number | null;
  on_sale: boolean;
  in_stock: boolean;
  low_stock_remaining: number | null;
  image_url: string | null;
  categories: string[];
  popularity_rank: number | null;
  first_seen_at: string;
  last_seen_at: string;
  gone: boolean;
  decision: string;
  candidate_product_id: string | null;
  candidate_product_name: string | null;
  candidate_selling_price_cents: number | null;
  match_score: number | null;
  match_uncertain: boolean;
  sourcing_note: string | null;
  sourcing_supplier_id: string | null;
  sourcing_supplier_name: string | null;
  sourcing_status: SourcingStatus | null;
  total_count: number;
};

// A row of competitor_shop_overview().
export type ShopRow = {
  id: string;
  name: string;
  base_url: string;
  status: "ok" | "refused" | "error" | "syncing";
  status_detail: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  next_page: number | null;
  total_items: number | null;
  created_at: string;
  items_count: number;
  proposed_count: number;
  missing_count: number;
  wanted_count: number;
  matched_count: number;
};

export type ListFilters = {
  shopId: string | null;
  category: string | null;
  inStockOnly: boolean;
  promoOnly: boolean;
  sort: MissingSort;
};

export const DEFAULT_FILTERS: ListFilters = {
  shopId: null,
  category: null,
  inStockOnly: false,
  promoOnly: false,
  sort: "popularity",
};

// Percent off, whole number, integers only. Null when there is no promo.
export function discountPercent(
  priceCents: number | null,
  regularCents: number | null
): number | null {
  if (
    priceCents === null ||
    regularCents === null ||
    regularCents <= 0 ||
    priceCents >= regularCents
  ) {
    return null;
  }
  return Math.round(((regularCents - priceCents) * 100) / regularCents);
}

// "Crème brûlée 100 g" -> "creme-brulee-100-g": for the file name of a photo.
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "photo";
}

export function imageFileName(productName: string, extension: string): string {
  const ext = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  return `${slugify(productName)}.${ext}`;
}

export function priceText(row: Pick<CatalogRow, "price_cents">): string | null {
  return row.price_cents === null ? null : formatMAD(row.price_cents);
}

// The text a WhatsApp / share sheet carries: name, their price, the note.
export function sourcingShareText(
  items: Pick<
    CatalogRow,
    "name" | "price_cents" | "sourcing_note" | "sourcing_supplier_name" | "sourcing_status"
  >[],
  labels: { heading: string; theirPrice: (price: string) => string; noPrice: string }
): string {
  const lines = items.map((item, index) => {
    const parts = [
      `${index + 1}. ${item.name}`,
      item.price_cents === null ? labels.noPrice : labels.theirPrice(formatMAD(item.price_cents)),
    ];
    if (item.sourcing_supplier_name) parts.push(item.sourcing_supplier_name);
    if (item.sourcing_note) parts.push(item.sourcing_note);
    return parts.join(" - ");
  });
  return [labels.heading, ...lines].join("\n");
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// Rows of the CSV export (see tablesToCsv: names are neutralised there).
export function sourcingCsvRows(
  items: Pick<
    CatalogRow,
    | "name"
    | "price_cents"
    | "regular_price_cents"
    | "shop_name"
    | "url"
    | "sourcing_note"
    | "sourcing_supplier_name"
    | "sourcing_status"
  >[],
  statusName: (status: SourcingStatus) => string
): (string | number)[][] {
  return items.map((item) => [
    item.name,
    item.price_cents === null ? "" : centsToDisplay(item.price_cents),
    item.regular_price_cents === null ? "" : centsToDisplay(item.regular_price_cents),
    item.shop_name,
    item.sourcing_supplier_name ?? "",
    item.sourcing_status ? statusName(item.sourcing_status) : "",
    item.sourcing_note ?? "",
    item.url,
  ]);
}

export function validateNote(note: string): { ok: true; note: string | null } | { ok: false } {
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX) return { ok: false };
  return { ok: true, note: trimmed === "" ? null : trimmed };
}

// Reasons the shop functions report (competitors.reason.*), for a shop that
// cannot be added or whose last read failed.
export function shopReason(reason: unknown): string {
  const known = new Set([
    "not_woocommerce",
    "currency_not_mad",
    "empty_catalogue",
    "no_prices",
    "already_added",
    "not_https",
    "private_host",
    "invalid_url",
    "robots_disallow",
    "robots_http_401",
    "robots_http_403",
    "robots_http_429",
    "http_401",
    "http_403",
    "http_429",
    "http_451",
    "bot_challenge",
    "timeout",
    "network",
    "unexpected",
    "too_large",
    "save_failed",
    "http_404",
    "http_500",
    "http_502",
    "http_503",
  ]);
  return typeof reason === "string" && known.has(reason)
    ? `competitors.shopReason.${reason}`
    : "competitors.shopReason.other";
}

// A read that ran out of time keeps its next page: the shop is still "syncing".
export function readProgress(
  shop: Pick<ShopRow, "status" | "next_page" | "total_items">
): number | null {
  if (shop.status !== "syncing" && shop.next_page === null) return null;
  return shop.next_page;
}

export function nextOffset(loaded: number, total: number): number | null {
  return loaded < total ? loaded : null;
}
