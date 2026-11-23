// Pure parsing for check-competitor-prices: no network, no Deno APIs, so jest
// can import it (tests/competitors/). The function does the fetching.

export const CRAWLER_TOKEN = "CornicheMarket-price-check";
export const USER_AGENT = `Mozilla/5.0 (compatible; ${CRAWLER_TOKEN}/1.0)`;

export type Reading = {
  title: string | null;
  // Integer centimes of MAD.
  priceCents: number | null;
  regularPriceCents: number | null;
  onSale: boolean;
  inStock: boolean;
  lowStockRemaining: number | null;
  imageUrl: string | null;
};

export type ParseResult =
  | { ok: true; reading: Reading }
  | { ok: false; status: "unsupported" | "error" | "refused"; detail: string };

const unsupported = (detail: string): ParseResult => ({ ok: false, status: "unsupported", detail });

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309 subset: groups, Allow/Disallow, * and $, longest match,
// Allow wins a tie)
// ---------------------------------------------------------------------------

type Rule = { allow: boolean; pattern: string };

function parseRobots(text: string): { agents: string[]; rules: Rule[] }[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      // A rule before any user-agent line belongs to no group.
      if (!current) continue;
      // An empty Disallow allows everything; an empty Allow is ignored.
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternMatches(pattern: string, path: string): number {
  // Returns the length of the match (specificity), or -1.
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${source}${anchored ? "$" : ""}`);
  return regex.test(path) ? body.replace(/\*/g, "").length : -1;
}

// May `agent` fetch `path` (with its query string) under this robots.txt? The
// group naming our agent applies; otherwise the `*` group; no group = allowed.
export function robotsAllows(robotsTxt: string, path: string, agent = CRAWLER_TOKEN): boolean {
  const groups = parseRobots(robotsTxt);
  const name = agent.toLowerCase();
  const named = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && a.length > 0 && name.includes(a))
  );
  const star = groups.filter((g) => g.agents.includes("*"));
  const applicable = named.length > 0 ? named : star;
  if (applicable.length === 0) return true;

  let bestLength = -1;
  let allowed = true;
  for (const group of applicable) {
    for (const rule of group.rules) {
      const length = patternMatches(rule.pattern, path || "/");
      if (length < 0) continue;
      if (length > bestLength || (length === bestLength && rule.allow)) {
        bestLength = length;
        allowed = rule.allow;
      }
    }
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Which reader applies to a URL
// ---------------------------------------------------------------------------

export type ReaderPlan =
  | { manual: true; reason: string }
  | { manual: false; readers: { kind: "woocommerce" | "shopify" | "page"; url: string }[] };

// Glovo loads prices from a private app API that we
// do not call: the owner types those prices.
const MANUAL_HOSTS = /(^|\.)(glovoapp\.com|glovo\.com)$/i;

export function parseHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function planReaders(raw: string): ReaderPlan {
  const url = parseHttpsUrl(raw);
  if (!url) return { manual: true, reason: "invalid_url" };
  if (MANUAL_HOSTS.test(url.hostname)) return { manual: true, reason: "app_only_site" };
  const readers: { kind: "woocommerce" | "shopify" | "page"; url: string }[] = [];
  const woo = wooStoreApiUrl(url);
  if (woo) readers.push({ kind: "woocommerce", url: woo });
  const shopify = shopifyJsUrl(url);
  if (shopify) readers.push({ kind: "shopify", url: shopify });
  readers.push({ kind: "page", url: url.toString() });
  return { manual: false, readers };
}

// https://shop/product/<slug>/ -> https://shop/wp-json/wc/store/v1/products?slug=<slug>
export function wooStoreApiUrl(url: URL): string | null {
  const match = url.pathname.match(/\/(?:product|produit|produits)\/([^/]+)\/?$/i);
  if (!match) return null;
  return `${url.origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(
    decodeURIComponent(match[1]).toLowerCase()
  )}`;
}

// https://shop/products/<handle> -> https://shop/products/<handle>.js
export function shopifyJsUrl(url: URL): string | null {
  const match = url.pathname.match(/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/products\/([^/]+?)(?:\.js)?\/?$/i);
  if (!match) return null;
  return `${url.origin}/products/${match[1]}.js`;
}

// ---------------------------------------------------------------------------
// HTTP outcome
// ---------------------------------------------------------------------------

export function looksLikeBotChallenge(body: string): boolean {
  const head = body.slice(0, 6000).toLowerCase();
  return (
    head.includes("just a moment...") ||
    head.includes("cf-chl") ||
    head.includes("challenge-platform") ||
    head.includes("attention required") ||
    head.includes("g-recaptcha") ||
    head.includes("hcaptcha") ||
    head.includes("captcha-delivery") ||
    head.includes("px-captcha") ||
    head.includes("access denied")
  );
}

// A refusal is never retried or worked around. 404/410 and server errors are
// ordinary failures.
export function classifyHttp(
  status: number,
  body = ""
): { kind: "ok" } | { kind: "refused" | "error"; detail: string } {
  if (status >= 200 && status < 300) {
    return looksLikeBotChallenge(body) && !/application\/ld\+json|"@type"/i.test(body)
      ? { kind: "refused", detail: "bot_challenge" }
      : { kind: "ok" };
  }
  if (status === 401 || status === 403 || status === 429 || status === 451) {
    return { kind: "refused", detail: `http_${status}` };
  }
  if ((status === 503 || status === 502) && looksLikeBotChallenge(body)) {
    return { kind: "refused", detail: "bot_challenge" };
  }
  if (status === 404 || status === 410) return { kind: "error", detail: "not_found" };
  return { kind: "error", detail: `http_${status}` };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// "18.00", "18,00", "1 234.50", "1.234,50", 18.5 -> centimes, never via float
// arithmetic on the amount. Null when it is not a plain positive amount.
export function priceTextToCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = String(value);
  }
  if (typeof value !== "string") return null;
  let text = value.replace(/[^\d.,]/g, "");
  if (!text || !/\d/.test(text)) return null;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const sep = text[at];
    const count = text.split(sep).length - 1;
    const after = text.length - at - 1;
    // "1,234" is a thousands group; "1.234" a three-decimal amount.
    decimalAt = count > 1 || (sep === "," && after === 3) ? -1 : at;
  }
  let whole: string;
  let fraction = "";
  if (decimalAt >= 0) {
    whole = text.slice(0, decimalAt).replace(/[.,]/g, "");
    fraction = text.slice(decimalAt + 1).replace(/[.,]/g, "");
  } else {
    whole = text.replace(/[.,]/g, "");
  }
  if (!whole) whole = "0";
  let cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1;
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

// An integer in the currency's minor unit ("1800" with minor unit 2) -> centimes.
export function minorUnitsToCents(value: unknown, minorUnit: unknown): number | null {
  const digits = typeof value === "number" ? String(value) : value;
  if (typeof digits !== "string" || !/^\d+$/.test(digits)) return null;
  const unit = typeof minorUnit === "string" ? Number(minorUnit) : minorUnit;
  if (typeof unit !== "number" || !Number.isInteger(unit) || unit < 0 || unit > 6) return null;
  const amount = Number(digits);
  let cents: number;
  if (unit === 2) cents = amount;
  else if (unit < 2) cents = amount * 10 ** (2 - unit);
  else {
    const divisor = 10 ** (unit - 2);
    cents = Math.floor(amount / divisor) + (amount % divisor >= divisor / 2 ? 1 : 0);
  }
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

const isMad = (currency: unknown) =>
  typeof currency === "string" && currency.trim().toUpperCase() === "MAD";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ecirc: "ê",
  ccedil: "ç",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : null;
}

function cleanImage(value: unknown, base?: string): string | null {
  let candidate: unknown = value;
  if (Array.isArray(candidate)) candidate = candidate[0];
  if (candidate && typeof candidate === "object") {
    const obj = candidate as Record<string, unknown>;
    candidate = obj.url ?? obj.contentUrl ?? obj.src;
  }
  if (typeof candidate !== "string") return null;
  let text = decodeEntities(candidate).trim();
  if (text.startsWith("//")) text = `https:${text}`;
  try {
    const url = new URL(text, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const result = url.toString();
    return result.length <= 2000 ? result : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WooCommerce Store API
// ---------------------------------------------------------------------------

export function parseWooStore(json: unknown, slug?: string): ParseResult {
  const list = Array.isArray(json) ? json : [];
  if (list.length === 0) return unsupported("woocommerce_no_product");
  const item = (slug
    ? list.find((p) => p && typeof p === "object" && (p as { slug?: unknown }).slug === slug)
    : undefined) ?? list[0];
  if (!item || typeof item !== "object") return unsupported("woocommerce_no_product");
  const product = item as Record<string, unknown>;
  const prices = (product.prices ?? {}) as Record<string, unknown>;
  if (!isMad(prices.currency_code)) return unsupported("currency_not_mad");
  const minor = prices.currency_minor_unit ?? 2;
  const price = minorUnitsToCents(prices.price, minor);
  const regular = minorUnitsToCents(prices.regular_price, minor);
  const inStock = product.is_in_stock !== false;
  if (price === null && inStock) return unsupported("woocommerce_no_price");
  const remaining = product.low_stock_remaining;
  const images = Array.isArray(product.images) ? product.images : [];
  const onSale = price !== null && regular !== null && regular > price;
  return {
    ok: true,
    reading: {
      title: cleanTitle(product.name),
      priceCents: price,
      regularPriceCents: onSale ? regular : price,
      onSale,
      inStock,
      lowStockRemaining:
        typeof remaining === "number" && Number.isInteger(remaining) && remaining >= 0
          ? remaining
          : null,
      imageUrl: cleanImage((images[0] as { src?: unknown } | undefined)?.src),
    },
  };
}

// ---------------------------------------------------------------------------
// Shopify /products/<handle>.js (prices are integer centimes)
// ---------------------------------------------------------------------------

export function parseShopifyJs(json: unknown): ParseResult {
  if (!json || typeof json !== "object" || Array.isArray(json)) return unsupported("shopify_format");
  const product = json as Record<string, unknown>;
  const price = minorUnitsToCents(product.price, 2);
  if (price === null) return unsupported("shopify_no_price");
  const compare = minorUnitsToCents(product.compare_at_price, 2);
  const onSale = compare !== null && compare > price;
  const featured = product.featured_image;
  const images = Array.isArray(product.images) ? product.images : [];
  return {
    ok: true,
    reading: {
      title: cleanTitle(product.title),
      priceCents: price,
      regularPriceCents: onSale ? compare : price,
      onSale,
      inStock: product.available !== false,
      lowStockRemaining: null,
      imageUrl: cleanImage(featured ?? images[0]),
    },
  };
}

// ---------------------------------------------------------------------------
// Generic page: schema.org Product JSON-LD, then OpenGraph
// ---------------------------------------------------------------------------

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const regex = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    const text = match[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    try {
      blocks.push(JSON.parse(text));
    } catch {
      // A broken block is skipped; others may still be fine.
    }
  }
  return blocks;
}

function collectNodes(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 6 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return;
  }
  const node = value as Record<string, unknown>;
  out.push(node);
  if (node["@graph"]) collectNodes(node["@graph"], out, depth + 1);
  if (node.mainEntity) collectNodes(node.mainEntity, out, depth + 1);
}

const typeIncludes = (node: Record<string, unknown>, wanted: string) => {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && t.replace(/^.*[/#]/, "") === wanted);
};

type Offer = { price: number; inStock: boolean; regular: number | null };

function availabilityInStock(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/^.*[/#]/, "").toLowerCase();
  if (/outofstock|soldout|discontinued/.test(text)) return false;
  if (/instock|limitedavailability|onlineonly|instoreonly|preorder|backorder/.test(text)) return true;
  return null;
}

function offersOf(value: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    const o = v as Record<string, unknown>;
    out.push(o);
    if (o.offers) walk(o.offers, depth + 1);
  };
  walk(value, 0);
  return out;
}

function offerFrom(raw: Record<string, unknown>): { offer: Offer | null; currencyProblem: boolean } {
  const spec = (Array.isArray(raw.priceSpecification) ? raw.priceSpecification[0] : raw.priceSpecification) as
    | Record<string, unknown>
    | undefined;
  const amount = raw.price ?? raw.lowPrice ?? spec?.price;
  const currency = raw.priceCurrency ?? spec?.priceCurrency;
  const cents = priceTextToCents(amount);
  if (cents === null) return { offer: null, currencyProblem: false };
  if (!isMad(currency)) return { offer: null, currencyProblem: true };
  const regularSpec = Array.isArray(raw.priceSpecification)
    ? (raw.priceSpecification as Record<string, unknown>[]).find((s) =>
        /list|strikethrough|msrp/i.test(String(s.priceType ?? ""))
      )
    : undefined;
  const regular = regularSpec ? priceTextToCents(regularSpec.price) : null;
  return {
    offer: { price: cents, inStock: availabilityInStock(raw.availability) ?? true, regular },
    currencyProblem: false,
  };
}

function metaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[0].matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? "";
    }
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !map.has(key)) map.set(key, attrs.content);
  }
  return map;
}

export function parseProductPage(html: string, pageUrl?: string): ParseResult {
  const nodes: Record<string, unknown>[] = [];
  for (const block of jsonLdBlocks(html)) collectNodes(block, nodes);
  const products = nodes.filter((node) => typeIncludes(node, "Product"));

  let sawNonMad = false;
  for (const product of products) {
    const offers: Offer[] = [];
    for (const raw of offersOf(product.offers)) {
      const { offer, currencyProblem } = offerFrom(raw);
      if (offer) offers.push(offer);
      sawNonMad ||= currencyProblem;
    }
    if (offers.length === 0) continue;
    // The shopper's best deal: cheapest offer that is in stock, else cheapest.
    const inStockOffers = offers.filter((o) => o.inStock);
    const pool = inStockOffers.length > 0 ? inStockOffers : offers;
    const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
    const onSale = best.regular !== null && best.regular > best.price;
    return {
      ok: true,
      reading: {
        title: cleanTitle(product.name),
        priceCents: best.price,
        regularPriceCents: onSale ? best.regular : best.price,
        onSale,
        inStock: inStockOffers.length > 0,
        lowStockRemaining: null,
        imageUrl: cleanImage(product.image, pageUrl),
      },
    };
  }

  const meta = metaTags(html);
  const amount = meta.get("product:price:amount") ?? meta.get("og:price:amount");
  if (amount !== undefined) {
    const currency = meta.get("product:price:currency") ?? meta.get("og:price:currency");
    const cents = priceTextToCents(amount);
    if (cents !== null && isMad(currency)) {
      const original = priceTextToCents(
        meta.get("product:original_price:amount") ?? meta.get("product:price:regular")
      );
      const onSale = original !== null && original > cents;
      return {
        ok: true,
        reading: {
          title: cleanTitle(meta.get("og:title")),
          priceCents: cents,
          regularPriceCents: onSale ? original : cents,
          onSale,
          inStock: availabilityInStock(meta.get("product:availability") ?? meta.get("og:availability")) ?? true,
          lowStockRemaining: null,
          imageUrl: cleanImage(meta.get("og:image"), pageUrl),
        },
      };
    }
    if (cents !== null) sawNonMad = true;
  }
  return unsupported(sawNonMad ? "currency_not_mad" : "no_product_data");
}

// ---------------------------------------------------------------------------
// Did anything change? (a price point is stored only when it did)
// ---------------------------------------------------------------------------

export type StoredPoint = {
  price_cents: number | null;
  regular_price_cents: number | null;
  in_stock: boolean;
};

export function readingChanged(previous: StoredPoint | null, reading: Reading): boolean {
  if (!previous) return true;
  return (
    previous.price_cents !== reading.priceCents ||
    previous.regular_price_cents !== reading.regularPriceCents ||
    previous.in_stock !== reading.inStock
  );
}
