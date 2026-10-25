import { supabase } from "@/src/lib/supabase/client";

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
};

export type Category = { id: string; name: string };

export type ProductStatusFilter = "active" | "inactive" | "all";

export type ProductFilters = {
  search: string;
  categoryId: string | null;
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
};

export const PAGE_SIZE = 50;

const LIST_COLUMNS =
  "id, name, barcode, category_id, unit, selling_price_cents, stock_quantity, low_stock_threshold, is_low_stock, active";

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
  const columns = isOwner ? `${LIST_COLUMNS}, current_cost_cents` : LIST_COLUMNS;
  let query = supabase.from(productsSource(isOwner)).select(columns);

  const term = sanitizeSearch(filters.search);
  if (term) {
    query = query.or(`name.ilike.*${term}*,barcode.ilike.${term}*`);
  }
  if (filters.categoryId) {
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

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from("categories").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Category[];
}

export async function fetchProduct(id: string, isOwner: boolean): Promise<Product | null> {
  const columns = isOwner ? `${LIST_COLUMNS}, current_cost_cents` : LIST_COLUMNS;
  const { data, error } = await supabase
    .from(productsSource(isOwner))
    .select(columns)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return { current_cost_cents: null, ...(data as object) } as Product;
}

export async function findByBarcode(
  barcode: string,
  isOwner: boolean
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from(productsSource(isOwner))
    .select("id, name")
    .eq("barcode", barcode)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as { id: string; name: string } | null) ?? null;
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
