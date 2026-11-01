import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "@/src/lib/supabase/client";
import { productsSource, type ProductUnit } from "@/src/lib/products/queries";
import { fetchGridCategories, fetchGridLayout } from "@/src/lib/sellGrid/queries";
import type { GridCategory, GridTab, GridTile } from "@/src/lib/sellGrid/layout";

const CACHE_KEY = "corniche.productCache.v2";
const LEGACY_CACHE_KEY = "corniche.productCache.v1";
const PAGE_SIZE = 200;
// Never a cost column: this cache is read on cashier devices too.
const CACHE_COLUMNS =
  "id, barcode, name, selling_price_cents, unit, active, category_id, stock_quantity, low_stock_threshold";

export type CachedProduct = {
  id: string;
  barcode: string | null;
  name: string;
  selling_price_cents: number;
  unit: ProductUnit;
  active: boolean;
  // Added in v2 (the Sell grid). Missing on entries read from a v1 cache.
  category_id?: string | null;
  stock_quantity?: number;
  low_stock_threshold?: number;
};

type ProductCache = {
  products: CachedProduct[];
  categories?: GridCategory[];
  grid?: { tabs: GridTab[]; tiles: GridTile[] };
  refreshedAt: string;
};

// v2 first; a device that has only the v1 cache (products and prices, no grid)
// keeps working until the next refresh writes v2.
async function readCache(): Promise<ProductCache | null> {
  const raw =
    (await AsyncStorage.getItem(CACHE_KEY)) ?? (await AsyncStorage.getItem(LEGACY_CACHE_KEY));
  return raw ? (JSON.parse(raw) as ProductCache) : null;
}

// Fetches all active products and writes them to AsyncStorage. Call when
// the device comes online so barcodes and prices are fresh.
export async function refreshProductCache(isOwner: boolean): Promise<void> {
  const all: CachedProduct[] = [];
  const source = productsSource(isOwner);

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(source)
      .select(CACHE_COLUMNS)
      .eq("active", true)
      .order("name")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CachedProduct[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // The grid must never stop the catalogue from refreshing: if its tables are
  // unreachable (or not deployed yet) the products and prices still update.
  let categories: GridCategory[] = [];
  let grid: ProductCache["grid"] = { tabs: [], tiles: [] };
  try {
    [categories, grid] = await Promise.all([fetchGridCategories(), fetchGridLayout()]);
  } catch {
    const previous = await readCache().catch(() => null);
    categories = previous?.categories ?? [];
    grid = previous?.grid ?? { tabs: [], tiles: [] };
  }

  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      products: all,
      categories,
      grid,
      refreshedAt: new Date().toISOString(),
    } satisfies ProductCache)
  );
  await AsyncStorage.removeItem(LEGACY_CACHE_KEY);
}

export async function getProductCacheMeta(): Promise<{ refreshedAt: string } | null> {
  try {
    const cache = await readCache();
    return cache ? { refreshedAt: cache.refreshedAt } : null;
  } catch {
    return null;
  }
}

export async function findCachedByBarcode(barcode: string): Promise<CachedProduct | null> {
  try {
    const cache = await readCache();
    if (!cache) return null;
    const { products } = cache;
    return products.find((p) => p.barcode === barcode && p.active) ?? null;
  } catch {
    return null;
  }
}

export async function searchCachedProducts(term: string, limit = 8): Promise<CachedProduct[]> {
  try {
    const cache = await readCache();
    if (!cache) return [];
    const { products } = cache;
    const lower = term.toLowerCase();
    return products
      .filter(
        (p) =>
          p.active && (p.name.toLowerCase().includes(lower) || (p.barcode ?? "").startsWith(term))
      )
      .slice(0, limit);
  } catch {
    return [];
  }
}

// Everything the Sell grid needs, from the device. Null when nothing is cached yet.
export async function getCachedGrid(): Promise<{
  products: CachedProduct[];
  categories: GridCategory[];
  tabs: GridTab[];
  tiles: GridTile[];
} | null> {
  try {
    const cache = await readCache();
    if (!cache) return null;
    return {
      products: cache.products,
      categories: cache.categories ?? [],
      tabs: cache.grid?.tabs ?? [],
      tiles: cache.grid?.tiles ?? [],
    };
  } catch {
    return null;
  }
}
