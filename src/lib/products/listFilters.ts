// Rules for the products list toolbar, kept out of the screen so a test pins them.
import type { ProductStatusFilter } from "@/src/lib/products/queries";

// Below this width the filters and secondary actions open on demand, so the
// product list keeps most of the screen.
export const COMPACT_PRODUCTS_WIDTH = 768;

export function isCompactProductsList(width: number): boolean {
  return width < COMPACT_PRODUCTS_WIDTH;
}

// How many filters narrow the list. "Active" is the default status, and a
// sub-category refines its category, so neither counts on its own.
export function activeFilterCount(filters: {
  categoryId: string | null;
  lowStockOnly: boolean;
  status: ProductStatusFilter;
}): number {
  return (
    (filters.categoryId !== null ? 1 : 0) +
    (filters.lowStockOnly ? 1 : 0) +
    (filters.status !== "active" ? 1 : 0)
  );
}
