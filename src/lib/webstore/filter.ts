// Search and filter chips of the webstore list. Pure.
import { priceConflict, resolvedPriceCents } from "./resolve";
import type { WebProduct } from "./types";

export type WebFilter = "all" | "published" | "hidden" | "unlinked" | "priceDiff" | "noPrice";

export const WEB_FILTERS: readonly WebFilter[] = [
  "all",
  "published",
  "hidden",
  "unlinked",
  "priceDiff",
  "noPrice",
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matchesSearch(p: WebProduct, term: string): boolean {
  const needle = fold(term.trim());
  if (!needle) return true;
  return [p.id, p.name, p.name_fr, p.keywords].some((v) => !!v && fold(v).includes(needle));
}

// "Prix différent": linked, and the price the site used to show is not the
// app's price (the owner has not chosen yet, or chose the app's).
export function matchesFilter(p: WebProduct, filter: WebFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "published":
      return p.published;
    case "hidden":
      return !p.published;
    case "unlinked":
      return p.product_id === null;
    case "priceDiff":
      return p.product_id !== null && priceConflict(p, p.app) !== null;
    case "noPrice":
      return resolvedPriceCents(p) === null;
  }
}

export function filterProducts(
  list: readonly WebProduct[],
  filter: WebFilter,
  term: string
): WebProduct[] {
  return list.filter((p) => matchesFilter(p, filter) && matchesSearch(p, term));
}
