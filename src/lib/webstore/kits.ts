// What the public page does with a kit, and the owner-side helpers around it.
// Pure: no Supabase. kitStatus mirrors webstore_feed() (migrations 054, 057)
// and the page, line by line; change one, change the others.
//
//  - The feed keeps the kits that are published AND have at least one line,
//    ordered by (sort, id), the first 20 only. A kit the page later hides
//    still takes one of the 20 places.
//  - Only the first 12 lines of a kit, ordered by (sort, web_product_id),
//    reach the page; the others are ignored.
//  - The page prices a kit itself (the live sum of price x qty of its lines)
//    and hides the kit when a line is missing from the feed, sold out or
//    without a price.
import { lineTotalCents } from "@/src/lib/money";
import { excludedReason, resolvedInStock, resolvedPriceCents } from "./resolve";
import type { WebKit, WebKitItem, WebProduct } from "./types";

export const FEED_KIT_LIMIT = 20;
export const FEED_KIT_ITEM_LIMIT = 12;
export const KIT_NAME_MAX = 60;
export const KIT_QTY_MIN = 1;
export const KIT_QTY_MAX = 10;
export const KIT_ID_MAX = 40;

// Why one line stops the kit from showing, in the order they are checked.
export type ItemProblemKind = "missing" | "hidden" | "excluded" | "soldOut" | "noPrice";

export type KitProblem =
  // A line of the kit.
  | { kind: ItemProblemKind; webProductId: string }
  // A line beyond the 12 the page reads: it is ignored (the kit still shows).
  | { kind: "tooManyItems"; webProductId: string }
  // The kit itself.
  | { kind: "unpublished" | "empty" | "overLimit" };

export type KitStatus = {
  // Sum of price x qty over the lines the page reads, null while one of them
  // is missing or has no price.
  priceCents: number | null;
  shownOnSite: boolean;
  // Kit-level reasons first, then the lines in order.
  problems: KitProblem[];
};

export const kitDisplayName = (kit: Pick<WebKit, "name" | "name_fr">): string =>
  (kit.name_fr ?? "").trim() || kit.name;

// The order the feed gives the lines: sort, then id (plain comparison, like SQL
// on ASCII ids).
export function orderedItems(items: readonly WebKitItem[]): WebKitItem[] {
  return [...items].sort(
    (a, b) =>
      a.sort - b.sort ||
      (a.web_product_id < b.web_product_id ? -1 : a.web_product_id > b.web_product_id ? 1 : 0)
  );
}

// The order the feed gives the kits: sort, then id.
export function orderedKits<T extends Pick<WebKit, "id" | "sort">>(kits: readonly T[]): T[] {
  return [...kits].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The first problem of one line, or null when the page can show it.
export function itemProblem(
  webProductId: string,
  byId: ReadonlyMap<string, WebProduct>
): ItemProblemKind | null {
  const wp = byId.get(webProductId);
  if (!wp) return "missing";
  if (!wp.published) return "hidden";
  if (excludedReason(wp) !== null) return "excluded";
  if (!resolvedInStock(wp)) return "soldOut";
  if (resolvedPriceCents(wp) === null) return "noPrice";
  return null;
}

// `overLimit`: the kit is beyond the first 20 the feed keeps (see
// overLimitKitIds). Lines with a problem are reported even when the kit is
// unpublished, so the owner sees what is wrong before publishing.
export function kitStatus(
  kit: Pick<WebKit, "published">,
  items: readonly WebKitItem[],
  webProducts: readonly WebProduct[],
  overLimit = false
): KitStatus {
  const byId = new Map(webProducts.map((p) => [p.id, p]));
  const ordered = orderedItems(items);
  const read = ordered.slice(0, FEED_KIT_ITEM_LIMIT);
  const problems: KitProblem[] = [];
  if (!kit.published) problems.push({ kind: "unpublished" });
  if (ordered.length === 0) problems.push({ kind: "empty" });
  if (kit.published && ordered.length > 0 && overLimit) problems.push({ kind: "overLimit" });

  let price: number | null = 0;
  let lineBlocksKit = false;
  for (const item of read) {
    const kind = itemProblem(item.web_product_id, byId);
    if (kind) {
      problems.push({ kind, webProductId: item.web_product_id });
      lineBlocksKit = true;
    }
    const wp = byId.get(item.web_product_id);
    const unit = wp ? resolvedPriceCents(wp) : null;
    if (price !== null) price = unit === null ? null : price + lineTotalCents(item.qty, unit);
  }
  for (const item of ordered.slice(FEED_KIT_ITEM_LIMIT)) {
    problems.push({ kind: "tooManyItems", webProductId: item.web_product_id });
  }

  const shownOnSite = kit.published && ordered.length > 0 && !overLimit && !lineBlocksKit;
  return { priceCents: ordered.length === 0 ? null : price, shownOnSite, problems };
}

// The kits the feed keeps: published, with at least one line, the first 20 by
// (sort, id). The rest are "overLimit".
export function overLimitKitIds(kits: readonly WebKit[]): Set<string> {
  const candidates = orderedKits(kits.filter((k) => k.published && k.items.length > 0));
  return new Set(candidates.slice(FEED_KIT_LIMIT).map((k) => k.id));
}

// The status of every kit, with the 20-kit limit applied.
export function kitStatuses(
  kits: readonly WebKit[],
  webProducts: readonly WebProduct[]
): Map<string, KitStatus> {
  const over = overLimitKitIds(kits);
  return new Map(kits.map((k) => [k.id, kitStatus(k, k.items, webProducts, over.has(k.id))]));
}

// More than 20 published kits with lines: the page cannot show them all.
export function publishedKitCount(kits: readonly WebKit[]): number {
  return kits.filter((k) => k.published && k.items.length > 0).length;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// <prefix>_<slug>: lowercase ASCII, accents removed, anything else becomes "_",
// at most 40 characters, unique among `existingIds` (compared ignoring case)
// by a "_2", "_3"... suffix. A name with no usable letter (Arabic only, say)
// gives "kit".
export function newKitId(name: string, existingIds: readonly string[]): string {
  const slug = fold(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = (slug ? `kit_${slug}` : "kit").slice(0, KIT_ID_MAX).replace(/_+$/, "");
  const taken = new Set(existingIds.map((id) => id.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, KIT_ID_MAX - suffix.length).replace(/_+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type KitFormValues = {
  name: string;
  nameFr: string;
  items: readonly Pick<WebKitItem, "web_product_id" | "qty">[];
};

export type KitFormErrors = {
  name?: string;
  nameFr?: string;
  items?: string;
  qty?: string;
};

// Mirrors the CHECK constraints of migration 054. Values are translation keys.
export function validateKit(values: KitFormValues): {
  errors: KitFormErrors;
  patch: { name: string; name_fr: string | null } | null;
} {
  const errors: KitFormErrors = {};
  const name = values.name.trim();
  const nameFr = values.nameFr.trim();
  if (!name) errors.name = "webstore.kits.errNameRequired";
  else if (name.length > KIT_NAME_MAX) errors.name = "webstore.kits.errNameTooLong";
  if (nameFr.length > KIT_NAME_MAX) errors.nameFr = "webstore.kits.errNameTooLong";
  if (values.items.length > FEED_KIT_ITEM_LIMIT) errors.items = "webstore.kits.errTooManyItems";
  if (
    values.items.some((i) => !Number.isInteger(i.qty) || i.qty < KIT_QTY_MIN || i.qty > KIT_QTY_MAX)
  ) {
    errors.qty = "webstore.kits.errQty";
  }
  if (Object.keys(errors).length > 0) return { errors, patch: null };
  return { errors, patch: { name, name_fr: nameFr === "" ? null : nameFr } };
}

export const clampQty = (qty: number): number =>
  Math.min(KIT_QTY_MAX, Math.max(KIT_QTY_MIN, Math.round(qty)));
