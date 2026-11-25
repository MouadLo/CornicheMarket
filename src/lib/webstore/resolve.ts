// What the site will show for a web product, and the owner-side helpers around
// it. Pure: no Supabase. resolvedPriceCents / resolvedInStock / isExcluded
// mirror webstore_feed() (migrations 054, 055) line by line; change one, change
// the other.
import {
  classify,
  prepareName,
  scorePrepared,
  type MatchClass,
} from "@/supabase/functions/_shared/competitorMatch";
import { webMatchName } from "./matchReport";
import type { LinkCandidate, WebProduct } from "./types";

// The page ignores the whole feed below this many products.
export const MIN_FEED_PRODUCTS = 20;

export type ExcludedReason = "missing" | "inactive" | "misc";

// A published row linked to an app product that is missing, inactive or the
// "Divers" item is dropped by the feed.
export function excludedReason(wp: WebProduct): ExcludedReason | null {
  if (wp.product_id === null) return null;
  if (!wp.app) return "missing";
  if (!wp.app.active) return "inactive";
  if (wp.app.kind === "misc") return "misc";
  return null;
}

export function isExcluded(wp: WebProduct): boolean {
  return excludedReason(wp) !== null;
}

// Linked: the app's selling price. Not linked: the typed price (null = "prix
// à confirmer").
export function resolvedPriceCents(wp: WebProduct): number | null {
  if (wp.product_id !== null) return wp.app ? wp.app.selling_price_cents : null;
  return wp.price_cents;
}

// Automatic: the app has some stock. Manual: the owner's switch.
export function resolvedInStock(wp: WebProduct): boolean {
  if (wp.stock_mode === "auto") return wp.app ? wp.app.stock_quantity > 0 : false;
  return wp.manual_in_stock;
}

export type FeedStatus = {
  published: number;
  // What the feed will really contain: published and not excluded.
  inFeed: number;
  inFeedInStock: number;
  belowMinimum: boolean;
  min: number;
  // Published but dropped by the feed.
  excluded: WebProduct[];
};

export function feedStatus(list: readonly WebProduct[]): FeedStatus {
  const published = list.filter((p) => p.published);
  const excluded = published.filter(isExcluded);
  const live = published.filter((p) => !isExcluded(p));
  return {
    published: published.length,
    inFeed: live.length,
    inFeedInStock: live.filter(resolvedInStock).length,
    belowMinimum: live.length < MIN_FEED_PRODUCTS,
    min: MIN_FEED_PRODUCTS,
    excluded,
  };
}

// Would the feed fall below the minimum if this row's publication changed to
// `published`? (The only change the list asks confirmation for.)
export function dropsBelowMinimum(
  list: readonly WebProduct[],
  id: string,
  published: boolean
): boolean {
  const before = feedStatus(list);
  const after = feedStatus(list.map((p) => (p.id === id ? { ...p, published } : p)));
  return !before.belowMinimum && after.belowMinimum;
}

// The next free "p###" id: highest number + 1, at least three digits. Ids that
// do not look like p### are ignored.
export function nextWebId(existingIds: readonly string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const match = /^p(\d{3,})$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `p${String(max + 1).padStart(3, "0")}`;
}

export type LinkSuggestion = {
  product: LinkCandidate;
  score: number;
  confidence: Exclude<MatchClass, "none">;
};

// The app products that look like this web product, best first. Inactive and
// "Divers" products are never proposed, nor are products `takenIds` (linked to
// another web product).
export function linkSuggestions(
  wp: Pick<WebProduct, "name" | "name_fr" | "size">,
  appProducts: readonly LinkCandidate[],
  n = 3,
  takenIds: ReadonlySet<string> = new Set()
): LinkSuggestion[] {
  const ours = prepareName(webMatchName(wp));
  const out: LinkSuggestion[] = [];
  for (const product of appProducts) {
    if (!product.active || product.kind === "misc" || takenIds.has(product.id)) continue;
    const result = scorePrepared(ours, prepareName(product.name));
    const confidence = classify(result);
    if (confidence === "none") continue;
    out.push({ product, score: result.score, confidence });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.product.name.localeCompare(b.product.name) ||
      (a.product.id < b.product.id ? -1 : 1)
  );
  return out.slice(0, Math.max(0, n));
}

export type PriceConflict = { siteCents: number; appCents: number };

// Both prices known and different: the owner must choose which one is right.
export function priceConflict(
  wp: Pick<WebProduct, "price_cents">,
  app: Pick<LinkCandidate, "selling_price_cents"> | null
): PriceConflict | null {
  if (!app) return null;
  const site = wp.price_cents;
  const appCents = app.selling_price_cents;
  if (site === null || site === undefined || appCents === null || appCents === undefined) {
    return null;
  }
  return site === appCents ? null : { siteCents: site, appCents };
}
