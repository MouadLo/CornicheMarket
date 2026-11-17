import { normalizeSearch } from "@/src/lib/products/search";

export const MAX_CATEGORY_NAME = 60;

export type CategoryRef = {
  id: string;
  name: string;
  code?: string | null;
  parent_id?: string | null;
};

// What the owner typed, tidied: trimmed, inner runs of spaces collapsed.
export function cleanCategoryName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

// The server keeps category names unique but only compares them exactly, so
// "boissons" would sit beside "Boissons". Compare as the owner would read
// them: ignoring case and accents ("epicerie" is "Épicerie").
export function findSameCategory(name: string, existing: CategoryRef[]): CategoryRef | null {
  const key = normalizeSearch(cleanCategoryName(name));
  return (
    existing.find((category) => normalizeSearch(cleanCategoryName(category.name)) === key) ?? null
  );
}

export type CategoryDecision =
  | { kind: "invalid" }
  // This category exists already: use it instead of creating a twin.
  | { kind: "existing"; category: CategoryRef }
  | { kind: "create"; name: string };

export function decideCategory(raw: string, existing: CategoryRef[]): CategoryDecision {
  const name = cleanCategoryName(raw);
  if (!name || name.length > MAX_CATEGORY_NAME) return { kind: "invalid" };
  const same = findSameCategory(name, existing);
  return same ? { kind: "existing", category: same } : { kind: "create", name };
}

// Keeps the list in the order the screens show it (by name).
export function withCategory(existing: CategoryRef[], added: CategoryRef): CategoryRef[] {
  return [...existing.filter((category) => category.id !== added.id), added].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function mainCategories<T extends CategoryRef>(all: T[]): T[] {
  return all.filter((category) => !category.parent_id);
}

export function subCategoriesOf<T extends CategoryRef>(all: T[], parentId: string): T[] {
  return all.filter((category) => category.parent_id === parentId);
}

// The ids a filter on this category covers: itself and, for a main category, its subs.
export function familyIds(all: CategoryRef[], id: string): string[] {
  return [id, ...subCategoriesOf(all, id).map((category) => category.id)];
}

// The main category a product's category belongs to (itself when it is one).
export function mainCategoryId(all: CategoryRef[], id: string | null): string | null {
  if (!id) return null;
  return all.find((category) => category.id === id)?.parent_id ?? id;
}

// Each main category followed by its sub-categories, keeping the given order.
export function inTreeOrder<T extends CategoryRef>(all: T[]): T[] {
  const ids = new Set(all.map((category) => category.id));
  return mainCategories(all)
    .flatMap((main) => [main, ...subCategoriesOf(all, main.id)])
    .concat(
      // A sub-category whose parent is missing from the list still shows.
      all.filter((category) => category.parent_id && !ids.has(category.parent_id))
    );
}
