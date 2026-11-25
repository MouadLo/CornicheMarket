// Ids, codes and validation for the site's categories and sub-categories
// (migration 054). Pure.
import type { WebCategory } from "./types";

export const CATEGORY_NAME_MAX = 120;
export const CATEGORY_ID_MAX = 20;
export const SUB_CODE_MAX = 40;

// The icons the public page draws. Anything else it shows as "bag".
export const CATEGORY_ICONS = ["drinks", "snacks", "phone", "home", "bag", "cup", "gift"] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export const isKnownIcon = (icon: string): icon is CategoryIcon =>
  (CATEGORY_ICONS as readonly string[]).includes(icon);

// What the page draws for a stored icon.
export const shownIcon = (icon: string): CategoryIcon => (isKnownIcon(icon) ? icon : "bag");

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// '^[a-z][a-z0-9]{1,19}$': ASCII letters and digits only, accents removed,
// starts with a letter, 2 to 20 characters. A name with no usable letter
// (Arabic only, "123") gives "cat". Unique among `existing` by a number
// suffix (2, 3, ...), the base being cut so the id still fits in 20.
export function newCategoryId(name: string, existing: readonly string[]): string {
  let slug = fold(name)
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^[0-9]+/, "");
  if (slug.length === 0) slug = "cat";
  else if (slug.length === 1) slug += "cat";
  const base = slug.slice(0, CATEGORY_ID_MAX);
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, CATEGORY_ID_MAX - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

// The English name, trimmed (at most 40), made unique within its category by
// " 2", " 3"... Two categories may use the same code: only its own sub-codes
// count.
export function newSubCode(name: string, existingInCategory: readonly string[]): string {
  const base = name.trim().slice(0, SUB_CODE_MAX).trim() || "sub";
  const taken = new Set(existingInCategory);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, SUB_CODE_MAX - suffix.length).trim() + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

export type NamesInput = { name: string; nameFr: string };
export type NamesErrors = { name?: string; nameFr?: string };

// Both names are required (the table forbids empty-less nulls) and at most 120
// characters. Values are translation keys.
export function validateNames(values: NamesInput): {
  errors: NamesErrors;
  names: { name: string; name_fr: string } | null;
} {
  const errors: NamesErrors = {};
  const name = values.name.trim();
  const nameFr = values.nameFr.trim();
  if (!name) errors.name = "webstore.cats.errNameRequired";
  else if (name.length > CATEGORY_NAME_MAX) errors.name = "webstore.cats.errNameTooLong";
  if (!nameFr) errors.nameFr = "webstore.cats.errNameRequired";
  else if (nameFr.length > CATEGORY_NAME_MAX) errors.nameFr = "webstore.cats.errNameTooLong";
  return Object.keys(errors).length > 0
    ? { errors, names: null }
    : { errors, names: { name, name_fr: nameFr } };
}

// A new icon must be one the page knows. (An icon already stored that is not
// known is left alone: renaming a category is never blocked by it.)
export function validateIconChoice(icon: string): string | null {
  return isKnownIcon(icon) ? null : "webstore.cats.errIcon";
}

// How many products use each category and each sub-category.
export type UsageCounts = {
  byCategory: Record<string, number>;
  // "<category id>/<sub code>"
  bySub: Record<string, number>;
};

export const subUsageKey = (categoryId: string, code: string) => `${categoryId}/${code}`;

export function countUsage(
  rows: readonly { category_id: string; sub_code: string | null }[]
): UsageCounts {
  const byCategory: Record<string, number> = {};
  const bySub: Record<string, number> = {};
  for (const r of rows) {
    byCategory[r.category_id] = (byCategory[r.category_id] ?? 0) + 1;
    if (r.sub_code !== null) {
      const key = subUsageKey(r.category_id, r.sub_code);
      bySub[key] = (bySub[key] ?? 0) + 1;
    }
  }
  return { byCategory, bySub };
}

export const categoryName = (c: Pick<WebCategory, "name" | "name_fr">): string =>
  c.name_fr.trim() || c.name;
