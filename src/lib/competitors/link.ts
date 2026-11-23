// Pure helpers for the competitor links form and the competitor section.
import type { StoredPoint } from "@/src/lib/competitors/types";

export const SHOP_NAME_MAX = 60;
export const URL_MAX = 2000;

export type LinkInputResult =
  { ok: true; shopName: string; url: string } | { ok: false; field: "shopName" | "url" };

// A shop name of 1 to 60 characters and an https address of at most 2000.
export function validateLinkInput(shopName: string, rawUrl: string): LinkInputResult {
  const name = shopName.trim();
  if (name.length < 1 || name.length > SHOP_NAME_MAX) return { ok: false, field: "shopName" };
  const text = rawUrl.trim();
  if (text.length > URL_MAX || /\s/.test(text)) return { ok: false, field: "url" };
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) {
      return { ok: false, field: "url" };
    }
  } catch {
    return { ok: false, field: "url" };
  }
  return { ok: true, shopName: name, url: text };
}

export type Freshness = { unit: "minutes" | "hours" | "days"; count: number } | null;

// How long ago something was checked, in the coarsest whole unit (never "0 min").
export function freshness(iso: string | null, now: number): Freshness {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 60) return { unit: "minutes", count: Math.max(1, minutes) };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / 24) };
}

// Reasons the function reports, mapped to i18n keys under competitors.reason.
const KNOWN_REASONS = new Set([
  "robots_disallow",
  "robots_http_401",
  "robots_http_403",
  "robots_http_429",
  "http_401",
  "http_403",
  "http_429",
  "http_451",
  "bot_challenge",
  "app_only_site",
  "invalid_url",
  "currency_not_mad",
  "no_product_data",
  "woocommerce_no_product",
  "woocommerce_no_price",
  "shopify_format",
  "shopify_no_price",
  "bad_json",
  "not_found",
  "timeout",
  "network",
  "unexpected",
]);

export function reasonKey(detail: string | null): string {
  if (detail && KNOWN_REASONS.has(detail)) return `competitors.reason.${detail}`;
  return "competitors.reason.other";
}

// The owner typed a price: store a point only if it differs from the last one.
export function manualPointChanged(
  previous: StoredPoint | null,
  next: { priceCents: number | null; inStock: boolean }
): boolean {
  if (!previous) return true;
  return previous.price_cents !== next.priceCents || previous.in_stock !== next.inStock;
}
