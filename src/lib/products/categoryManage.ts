import {
  cleanCategoryName,
  findSameCategory,
  MAX_CATEGORY_NAME,
  type CategoryRef,
} from "@/src/lib/products/categories";
import {
  existingFor,
  findCatalogEntry,
  type CatalogEntry,
} from "@/src/lib/products/categoryCatalog";

export type ManagedCategory = CategoryRef & { productCount: number };

export type RenameDecision =
  | { kind: "invalid" }
  | { kind: "unchanged" }
  // A standard category's label comes from its code: renaming it would do nothing visible.
  | { kind: "standard" }
  // Another category already reads the same: merge into it instead.
  | { kind: "clash"; other: CategoryRef }
  | { kind: "rename"; name: string };

export function decideRename(
  category: CategoryRef,
  raw: string,
  all: CategoryRef[]
): RenameDecision {
  if (findCatalogEntry(category.code)) return { kind: "standard" };
  const name = cleanCategoryName(raw);
  if (!name || name.length > MAX_CATEGORY_NAME) return { kind: "invalid" };
  if (name === category.name) return { kind: "unchanged" };
  const same = findSameCategory(
    name,
    all.filter((other) => other.id !== category.id)
  );
  return same ? { kind: "clash", other: same } : { kind: "rename", name };
}

export type LinkDecision =
  | { kind: "already" }
  // The shop already has this standard category: merge into it.
  | { kind: "merge"; target: CategoryRef }
  | { kind: "link"; name: string; code: string };

export function decideLink(
  category: CategoryRef,
  entry: CatalogEntry,
  all: CategoryRef[]
): LinkDecision {
  if (category.code === entry.code) return { kind: "already" };
  const twin = existingFor(
    entry,
    all.filter((other) => other.id !== category.id)
  );
  return twin
    ? { kind: "merge", target: twin }
    : { kind: "link", name: entry.fr, code: entry.code };
}

export function mergeTargets<T extends CategoryRef>(source: CategoryRef, all: T[]): T[] {
  return all.filter((other) => other.id !== source.id);
}

// Deleting a category with products would leave them uncategorised without a
// word; the owner merges them somewhere first.
export function canDelete(category: ManagedCategory): boolean {
  return category.productCount === 0;
}
