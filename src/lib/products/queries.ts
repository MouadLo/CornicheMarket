import { barcodeVariants, pickByBarcode } from "@/src/lib/scanner/barcode";
import { supabase } from "@/src/lib/supabase/client";
import type { DiscountOverride } from "@/src/lib/sales/discountLimit";

export type ProductUnit = "piece" | "kg" | "pack";

export type Product = {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string | null;
  unit: ProductUnit;
  selling_price_cents: number;
  stock_quantity: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
  active: boolean;
  // Always null for cashiers: they read a view that has no cost column.
  current_cost_cents: number | null;
  // Whether a cashier may discount it (a computed column the database gives
  // both the table and the cashier view). Missing on rows from an older cache.
  discountable?: boolean;
  // The owner's choice for this product; only owners read it (null = automatic).
  discount_override?: DiscountOverride;
};

// code: the stable identity of a catalogue category (migration 035); null for
// one the owner typed himself. parent_id: set on a sub-category (migration 036).
export type Category = {
  id: string;
  name: string;
  code?: string | null;
  parent_id?: string | null;
};

export type ProductStatusFilter = "active" | "inactive" | "all";

export type ProductFilters = {
  search: string;
  categoryId: string | null;
  // A main category and its sub-categories (see familyIds); wins over categoryId.
  categoryIds?: string[];
  lowStockOnly: boolean;
  status: ProductStatusFilter;
};

export type ProductInput = {
  name: string;
  barcode: string | null;
  category_id: string | null;
  unit: ProductUnit;
  selling_price_cents: number;
  low_stock_threshold: number;
  active: boolean;
  discount_override?: DiscountOverride;
};

export const PAGE_SIZE = 50;

const LIST_COLUMNS =
  "id, name, barcode, category_id, unit, selling_price_cents, stock_quantity, low_stock_threshold, is_low_stock, active, discountable";

// The owner also reads the buying price and his cashier-discount choice.
const OWNER_COLUMNS = `${LIST_COLUMNS}, current_cost_cents, discount_override`;

export function productsSource(isOwner: boolean) {
  return isOwner ? "products" : "products_cashier_view";
}

// PostgREST reads commas and parens in or() as filter syntax, so a search
// term containing them would produce a malformed query rather than no match.
function sanitizeSearch(term: string): string {
  return term.replace(/[,()*\\]/g, " ").trim();
}

export async function fetchProducts(
  filters: ProductFilters,
  page: number,
  isOwner: boolean
): Promise<Product[]> {
  const columns = isOwner ? OWNER_COLUMNS : LIST_COLUMNS;
  // The built-in Divers item is not part of the catalogue.
  let query = supabase.from(productsSource(isOwner)).select(columns).eq("kind", "regular");

  const term = sanitizeSearch(filters.search);
  if (term) {
    query = query.or(`name.ilike.*${term}*,barcode.ilike.${term}*`);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    query = query.in("category_id", filters.categoryIds);
  } else if (filters.categoryId) {
    query = query.eq("category_id", filters.categoryId);
  }
  if (filters.lowStockOnly) {
    query = query.eq("is_low_stock", true);
  }
  if (filters.status !== "all") {
    query = query.eq("active", filters.status === "active");
  }

  const from = page * PAGE_SIZE;
  const { data, error } = await query.order("name").range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    current_cost_cents: null,
    ...(row as object),
  })) as Product[];
}

// 42703: a column does not exist yet (this app version reached a database
// without migration 035 or 036). Fall back to the columns that do.
const CATEGORY_COLUMNS = ["id, name, code, parent_id", "id, name, code", "id, name"];

export async function fetchCategories(): Promise<Category[]> {
  for (const columns of CATEGORY_COLUMNS) {
    const { data, error } = await supabase.from("categories").select(columns).order("name");
    if (!error) return (data ?? []) as unknown as Category[];
    if (error.code !== "42703") throw new Error(error.message);
  }
  return [];
}

// Owner only (row-level security). The database also adds the category's tab
// to the Sell screen. Callers check for an existing twin first (see
// decideCategory): the server only treats exact spellings as duplicates.
export async function createCategory(
  name: string,
  code: string | null = null,
  parentId: string | null = null
): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .insert({ name, ...(code ? { code } : {}), ...(parentId ? { parent_id: parentId } : {}) })
    .select()
    .single();
  if (error) throw new Error(error.message);
  const row = data as Category;
  return { id: row.id, name: row.name, code: row.code ?? null, parent_id: row.parent_id ?? null };
}

export type CategoryWithCount = Category & { productCount: number };

// Owner only. Counts every product, active or not: they all keep the category.
export async function fetchCategoriesWithCounts(): Promise<CategoryWithCount[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, code, parent_id, products(count)")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const counts = (row as { products?: { count: number }[] }).products;
    return {
      id: row.id as string,
      name: row.name as string,
      code: (row.code as string | null) ?? null,
      parent_id: (row.parent_id as string | null) ?? null,
      productCount: counts?.[0]?.count ?? 0,
    };
  });
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("categories").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function linkCategoryToCatalog(id: string, name: string, code: string): Promise<void> {
  const { error } = await supabase.from("categories").update({ name, code }).eq("id", id);
  if (error) throw new Error(error.message);
}

// Moves the products, then deletes the emptied category (its Sell tab goes
// with it; the target keeps its own). If the delete fails the source is just
// left empty, and the owner can delete it.
export async function mergeCategory(fromId: string, intoId: string): Promise<void> {
  const moved = await supabase
    .from("products")
    .update({ category_id: intoId })
    .eq("category_id", fromId);
  if (moved.error) throw new Error(moved.error.message);
  await deleteCategory(fromId);
}

// null makes it a main category again. The database refuses a second level.
export async function setCategoryParent(id: string, parentId: string | null): Promise<void> {
  const { error } = await supabase.from("categories").update({ parent_id: parentId }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchProduct(id: string, isOwner: boolean): Promise<Product | null> {
  const columns = isOwner ? OWNER_COLUMNS : LIST_COLUMNS;
  const { data, error } = await supabase
    .from(productsSource(isOwner))
    .select(columns)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return { current_cost_cents: null, ...(data as object) } as Product;
}

// The lookup a barcode scan needs: the ACTIVE product whose barcode is the
// scanned code, and nothing else. fetchProducts({search}) is a text search
// (name contains OR barcode starts with), so using it for a scan could add the
// wrong product for a short or partial code. The scanned code is also tried in
// its equivalent forms (a 12-digit UPC-A saved, the iPhone reads it with a
// leading 0, see barcodeVariants), the exact text winning. The offline cache
// does the same in findCachedByBarcode.
export async function fetchProductByBarcode(
  barcode: string,
  isOwner: boolean
): Promise<Product | null> {
  const columns = isOwner ? OWNER_COLUMNS : LIST_COLUMNS;
  const variants = barcodeVariants(barcode);
  // Exact text only, never "starts with": in() over the equivalent forms.
  const { data, error } = await supabase
    .from(productsSource(isOwner))
    .select(columns)
    .in("barcode", variants)
    .eq("active", true)
    .limit(variants.length * 2);

  if (error) throw new Error(error.message);
  const row = pickByBarcode(barcode, (data ?? []) as unknown as { barcode: string | null }[]);
  return row ? ({ current_cost_cents: null, ...(row as object) } as Product) : null;
}

// Any product (active or not) already using this barcode or an equivalent form
// of it: the duplicate warning of the product form, and stock receiving.
export async function findByBarcode(
  barcode: string,
  isOwner: boolean
): Promise<{ id: string; name: string } | null> {
  const variants = barcodeVariants(barcode);
  const { data, error } = await supabase
    .from(productsSource(isOwner))
    .select("id, name, barcode")
    .in("barcode", variants)
    .limit(variants.length * 2);

  if (error) throw new Error(error.message);
  const row = pickByBarcode(
    barcode,
    (data ?? []) as unknown as { id: string; name: string; barcode: string | null }[]
  );
  return row ? { id: row.id, name: row.name } : null;
}

export async function createProduct(input: ProductInput): Promise<string> {
  const { data, error } = await supabase.from("products").insert(input).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  const { error } = await supabase.from("products").update(input).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateSellingPrice(id: string, sellingPriceCents: number): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ selling_price_cents: sellingPriceCents })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function batchUpdateSellingPrices(
  updates: { product_id: string; selling_price_cents: number }[]
): Promise<void> {
  const { error } = await supabase.rpc("batch_update_selling_prices", {
    p_updates: updates,
  });
  if (error) throw new Error(error.message);
}

// Every active product a bulk price change would touch, with its buying price,
// so the owner can be shown the real result before it is applied. Walks the
// pages: PostgREST caps the rows of one response.
// categoryIds: the main category and its subs, as the server's bulk change counts them.
export async function fetchBulkPriceTargets(
  categoryId: string | null,
  categoryIds?: string[]
): Promise<Product[]> {
  const all: Product[] = [];
  const filters: ProductFilters = {
    search: "",
    categoryId,
    categoryIds,
    lowStockOnly: false,
    status: "active",
  };
  for (let page = 0; ; page += 1) {
    const batch = await fetchProducts(filters, page, true);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) return all;
  }
}

export async function bulkAdjustSellingPrice(
  categoryId: string | null,
  percent: number
): Promise<number> {
  const { data, error } = await supabase.rpc("bulk_adjust_selling_price", {
    p_category_id: categoryId,
    p_percent: percent,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export type PriceChangeBatch = {
  id: string;
  created_at: string;
  category_id: string | null;
  percent: number;
  product_count: number;
  reverted_at: string | null;
};

// The latest bulk price changes, newest first (owner only: RLS returns nothing
// to anyone else).
export async function fetchRecentPriceChanges(limit = 10): Promise<PriceChangeBatch[]> {
  const { data, error } = await supabase
    .from("price_change_batches")
    .select("id, created_at, category_id, percent, product_count, reverted_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as PriceChangeBatch[]).map((row) => ({
    ...row,
    percent: Number(row.percent),
  }));
}

export type UndoPriceChangeResult = { restored: number; skipped: number };

// Puts the old prices back, except on products edited since the change.
export async function undoPriceChange(batchId: string): Promise<UndoPriceChangeResult> {
  const { data, error } = await supabase.rpc("undo_price_change_batch", {
    p_batch_id: batchId,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Partial<UndoPriceChangeResult>;
  return { restored: result.restored ?? 0, skipped: result.skipped ?? 0 };
}

// Export walks every page rather than relying on a single large request,
// since PostgREST caps rows per response.
export async function fetchAllProducts(isOwner: boolean): Promise<Product[]> {
  const all: Product[] = [];
  const filters: ProductFilters = {
    search: "",
    categoryId: null,
    lowStockOnly: false,
    status: "all",
  };

  for (let page = 0; ; page += 1) {
    const batch = await fetchProducts(filters, page, isOwner);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return all;
}

// Cheapest possible check for "has the owner added anything yet" -- one row,
// no count. Used only to decide whether Sell shows its first-run prompt
// (production starts with 0 products), so a failed check should never block
// the Sell screen: callers treat an error the same as "has products."
export async function hasAnyProducts(): Promise<boolean> {
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("kind", "regular")
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
