import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "@/src/lib/supabase/client";
import { productsSource, type ProductUnit } from "@/src/lib/products/queries";

const CACHE_KEY = "corniche.productCache.v1";
const PAGE_SIZE = 200;
const CACHE_COLUMNS = "id, barcode, name, selling_price_cents, unit, active";

export type CachedProduct = {
  id: string;
  barcode: string | null;
  name: string;
  selling_price_cents: number;
  unit: ProductUnit;
  active: boolean;
};

type ProductCache = {
  products: CachedProduct[];
  refreshedAt: string;
};

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

  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ products: all, refreshedAt: new Date().toISOString() } satisfies ProductCache)
  );
}

export async function getProductCacheMeta(): Promise<{ refreshedAt: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { refreshedAt } = JSON.parse(raw) as ProductCache;
    return { refreshedAt };
  } catch {
    return null;
  }
}

export async function findCachedByBarcode(barcode: string): Promise<CachedProduct | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { products } = JSON.parse(raw) as ProductCache;
    return products.find((p) => p.barcode === barcode && p.active) ?? null;
  } catch {
    return null;
  }
}

export async function searchCachedProducts(term: string, limit = 8): Promise<CachedProduct[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const { products } = JSON.parse(raw) as ProductCache;
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
