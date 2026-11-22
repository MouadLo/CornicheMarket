import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "@/src/lib/supabase/client";
import { productsSource, type ProductUnit } from "@/src/lib/products/queries";
import { rankBySearch } from "@/src/lib/products/search";
import { pickByBarcode } from "@/src/lib/scanner/barcode";
import { parseDiversConfig, type DiversConfig } from "@/src/lib/sellGrid/divers";
import {
  fetchDiversConfig,
  fetchGridCategories,
  fetchGridLayout,
} from "@/src/lib/sellGrid/queries";
import type { GridCategory, GridTab, GridTile } from "@/src/lib/sellGrid/layout";

const CACHE_KEY = "corniche.productCache.v2";
const LEGACY_CACHE_KEY = "corniche.productCache.v1";
const PAGE_SIZE = 200;
// Never a cost column: this cache is read on cashier devices too.
const CACHE_COLUMNS =
  "id, barcode, name, selling_price_cents, unit, active, category_id, stock_quantity, low_stock_threshold, discountable, loyalty_excluded, loyalty_bonus_points, loyalty_bonus_until";

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
  // Added with the cashier discount limit. Missing on older entries (read as allowed).
  discountable?: boolean;
  // Loyalty (migration 048), so points can be estimated offline. Not cost data.
  // Missing on older entries (read as eligible, no bonus).
  loyalty_excluded?: boolean;
  loyalty_bonus_points?: number;
  loyalty_bonus_until?: string | null;
};

type ProductCache = {
  products: CachedProduct[];
  categories?: GridCategory[];
  grid?: { tabs: GridTab[]; tiles: GridTile[] };
  // The built-in Divers product and the cashier's maximum (the product id and
  // one number: never a cost). Added to v2 without a version change, like the
  // other optional fields: a cache written before has none, and the tile stays
  // hidden until the next online refresh fills it.
  divers?: DiversConfig | null;
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
      .eq("kind", "regular")
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

  // Same rule for Divers: a failed read keeps what the device already knew; a
  // successful one with no Divers product (older database) clears it.
  let divers: DiversConfig | null;
  try {
    divers = await fetchDiversConfig();
  } catch {
    divers = parseDiversConfig((await readCache().catch(() => null))?.divers);
  }

  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      products: all,
      categories,
      grid,
      divers,
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
    // Same rule as fetchProductByBarcode: equivalent forms, exact text first.
    return pickByBarcode(
      barcode,
      products.filter((p) => p.active)
    );
  } catch {
    return null;
  }
}

// Active products matching the term, best first (names that start with it,
// then words, then the rest), accents and case ignored. Ranked before the
// limit is applied, so the best matches are never cut off by the alphabet.
export async function searchCachedProducts(term: string, limit = 8): Promise<CachedProduct[]> {
  try {
    const cache = await readCache();
    if (!cache) return [];
    return rankBySearch(
      cache.products.filter((p) => p.active),
      term
    ).slice(0, limit);
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
  divers: DiversConfig | null;
} | null> {
  try {
    const cache = await readCache();
    if (!cache) return null;
    return {
      products: cache.products,
      categories: cache.categories ?? [],
      tabs: cache.grid?.tabs ?? [],
      tiles: cache.grid?.tiles ?? [],
      divers: parseDiversConfig(cache.divers),
    };
  } catch {
    return null;
  }
}
