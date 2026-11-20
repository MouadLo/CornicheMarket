/**
 * "My place" in the Products list: which product the owner opened, how far down
 * the list they were, and the filters they had. Held in module memory so it
 * survives the list screen being remounted (web) within one app session; it is
 * deliberately never persisted. Pure data + two tiny accessors, no React.
 */
import type { ProductStatusFilter } from "./queries";

export type PlaceFilters = {
  search: string;
  categoryId: string | null;
  subCategoryId: string | null;
  lowStockOnly: boolean;
  status: ProductStatusFilter;
};

export type ListPlace = {
  /** The product opened for editing; null when leaving for "new product". */
  productId: string | null;
  /** Row index the product had (or the first visible row when productId is null). */
  index: number;
  /** Highest page index that was loaded. */
  loadedPages: number;
  filtersKey: string;
  filters: PlaceFilters;
};

export const DEFAULT_PLACE_FILTERS: PlaceFilters = {
  search: "",
  categoryId: null,
  subCategoryId: null,
  lowStockOnly: false,
  status: "active",
};

/** Stable serialisation of the active filters: same filters, same string. */
export function filtersKeyOf(filters: PlaceFilters): string {
  return JSON.stringify([
    filters.search.trim(),
    filters.categoryId,
    filters.subCategoryId,
    filters.lowStockOnly,
    filters.status,
  ]);
}

/** A remembered place only applies to the list it was taken from. */
export function placeApplies(
  place: ListPlace | null,
  currentFiltersKey: string
): place is ListPlace {
  return place !== null && place.filtersKey === currentFiltersKey;
}

/** Row index to land on when the product is gone from the reloaded pages. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), length - 1);
}

let current: ListPlace | null = null;

export function rememberPlace(input: Omit<ListPlace, "filtersKey">): void {
  current = { ...input, filtersKey: filtersKeyOf(input.filters) };
}

/** Look without clearing (used to seed the first render after a remount). */
export function peekPlace(): ListPlace | null {
  return current;
}

/** Read and clear: a place is used once. */
export function takePlace(): ListPlace | null {
  const place = current;
  current = null;
  return place;
}

export function clearPlace(): void {
  current = null;
}
