import { normalizeSearch } from "@/src/lib/products/search";

export const MAX_CATEGORY_NAME = 60;

export type CategoryRef = { id: string; name: string };

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
