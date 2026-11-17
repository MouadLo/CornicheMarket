import {
  cleanCategoryName,
  findSameCategory,
  MAX_CATEGORY_NAME,
  type CategoryRef,
} from "@/src/lib/products/categories";
import { existingFor, findCatalogEntry, type CatalogSub } from "@/src/lib/products/categoryCatalog";

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
  entry: CatalogSub,
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

function hasSubs(category: CategoryRef, all: CategoryRef[]): boolean {
  return all.some((other) => other.parent_id === category.id);
}

// Deleting a category with products would leave them uncategorised without a
// word; the owner merges them somewhere first. Its sub-categories go first too.
export function canDelete(category: ManagedCategory, all: CategoryRef[]): boolean {
  return category.productCount === 0 && !hasSubs(category, all);
}

// Merging or moving a main category would strand its sub-categories.
export function canMergeOrMove(category: CategoryRef, all: CategoryRef[]): boolean {
  return !hasSubs(category, all);
}

// The main categories this one can go under (one level only).
export function moveTargets<T extends CategoryRef>(category: CategoryRef, all: T[]): T[] {
  if (hasSubs(category, all)) return [];
  return all.filter(
    (other) => !other.parent_id && other.id !== category.id && other.id !== category.parent_id
  );
}
