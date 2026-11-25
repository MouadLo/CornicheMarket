// Validation of the edit form, mirroring the CHECK constraints of migration
// 054 so the owner reads a field error, never a database error. Pure.
import { parseMoneyToCents } from "@/src/lib/money";
import type { StockMode, WebCategory, WebProductPatch } from "./types";

export const NAME_MAX = 120;
// A price above a million dirhams is a typing mistake, not a price.
export const PRICE_MAX_CENTS = 100_000_000;

export type FormValues = {
  name: string;
  nameFr: string;
  size: string;
  categoryId: string;
  subCode: string | null;
  popular: boolean;
  keywords: string;
  imageUrl: string;
  // The typed price, as typed ("" = prix à confirmer). Ignored while linked.
  priceText: string;
  stockMode: StockMode;
  manualInStock: boolean;
};

export type FormField = "name" | "nameFr" | "category" | "image" | "price" | "stock";
// Values are translation keys.
export type FormErrors = Partial<Record<FormField, string>>;

// https only (the page is served over https; the table checks '^https://').
export function isValidImageUrl(raw: string): boolean {
  const value = raw.trim();
  if (!/^https:\/\//.test(value) || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const orNull = (s: string): string | null => {
  const v = s.trim();
  return v === "" ? null : v;
};

export function validateForm(
  values: FormValues,
  context: { linked: boolean; categories: readonly WebCategory[] }
): { errors: FormErrors; patch: WebProductPatch | null } {
  const errors: FormErrors = {};

  const name = values.name.trim();
  if (!name) errors.name = "webstore.errNameRequired";
  else if (name.length > NAME_MAX) errors.name = "webstore.errNameTooLong";

  if (values.nameFr.trim().length > NAME_MAX) errors.nameFr = "webstore.errNameTooLong";

  const category = context.categories.find((c) => c.id === values.categoryId);
  if (!category) errors.category = "webstore.errCategoryRequired";

  if (values.imageUrl.trim() !== "" && !isValidImageUrl(values.imageUrl)) {
    errors.image = "webstore.errImageUrl";
  }

  let priceCents: number | null = null;
  if (!context.linked) {
    const text = values.priceText.trim();
    if (text !== "") {
      const parsed = parseMoneyToCents(text);
      if (parsed === null || parsed > PRICE_MAX_CENTS) errors.price = "webstore.errPrice";
      else priceCents = parsed;
    }
  }

  if (values.stockMode === "auto" && !context.linked) errors.stock = "webstore.errAutoNeedsLink";

  if (Object.keys(errors).length > 0) return { errors, patch: null };

  // A sub-category that does not belong to the chosen category is dropped (the
  // table's composite foreign key would refuse it).
  const subCode =
    values.subCode && category?.subs.some((s) => s.code === values.subCode) ? values.subCode : null;

  const patch: WebProductPatch = {
    name,
    name_fr: orNull(values.nameFr),
    size: orNull(values.size),
    category_id: values.categoryId,
    sub_code: subCode,
    popular: values.popular,
    keywords: orNull(values.keywords),
    image_url: orNull(values.imageUrl),
    stock_mode: values.stockMode,
    manual_in_stock: values.manualInStock,
  };
  // While linked the typed price stays untouched ("ancien prix du site").
  if (!context.linked) patch.price_cents = priceCents;
  return { errors, patch };
}
