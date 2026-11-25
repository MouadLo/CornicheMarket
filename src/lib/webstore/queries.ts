// Data access for the owner's "Boutique en ligne" section. Owner only: RLS on
// the web_* tables refuses anyone else. Reads the base `products` table (the
// owner may see stock and prices), never the cashier view.
//
// Changing the app price of a linked product does NOT live here: the screen
// calls updateSellingPrice() from src/lib/products/queries.ts, which the
// selling_price_history trigger (migration 027) records.
import { supabase } from "@/src/lib/supabase/client";
import { nextWebId } from "./resolve";
import type {
  LinkCandidate,
  LinkedAppProduct,
  NewWebProduct,
  WebCategory,
  WebProduct,
  WebProductPatch,
} from "./types";

const PAGE = 1000;

const APP_COLUMNS = "id, name, selling_price_cents, stock_quantity, active, kind";

const WEB_COLUMNS =
  "id, product_id, name, name_fr, size, category_id, sub_code, popular, keywords, image_url, price_cents, stock_mode, manual_in_stock, published, sort";

type WebRow = Omit<WebProduct, "app"> & {
  product: LinkedAppProduct | LinkedAppProduct[] | null;
};

const toApp = (value: WebRow["product"]): LinkedAppProduct | null => {
  const row = Array.isArray(value) ? (value[0] ?? null) : value;
  return row ? { ...row, stock_quantity: Number(row.stock_quantity) } : null;
};

// The owner's own order first (it is the order of the site), then the id.
export async function fetchWebProducts(): Promise<WebProduct[]> {
  const all: WebProduct[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("web_products")
      .select(`${WEB_COLUMNS}, product:products(${APP_COLUMNS})`)
      .order("sort")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as WebRow[];
    for (const { product, ...row } of rows) all.push({ ...row, app: toApp(product) });
    if (rows.length < PAGE) return all;
  }
}

export async function fetchWebProduct(id: string): Promise<WebProduct | null> {
  const { data, error } = await supabase
    .from("web_products")
    .select(`${WEB_COLUMNS}, product:products(${APP_COLUMNS})`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { product, ...row } = data as unknown as WebRow;
  return { ...row, app: toApp(product) };
}

export async function fetchWebCategories(): Promise<WebCategory[]> {
  const { data, error } = await supabase
    .from("web_categories")
    .select("id, name, name_fr, icon, sort, subs:web_subcategories(code, name, name_fr, sort)")
    .order("sort")
    .order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as WebCategory[]).map((c) => ({
    ...c,
    subs: [...(c.subs ?? [])].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code)),
  }));
}

// Every app product the owner may link to (regular and active), for the
// suggestions and the picker.
export async function fetchLinkCandidates(): Promise<LinkCandidate[]> {
  const all: LinkCandidate[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select(APP_COLUMNS)
      .eq("kind", "regular")
      .eq("active", true)
      .order("name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as LinkCandidate[];
    all.push(...rows.map((r) => ({ ...r, stock_quantity: Number(r.stock_quantity) })));
    if (rows.length < PAGE) return all;
  }
}

// The kits that use this web product (so the delete confirmation can say so).
export async function fetchKitsUsing(webProductId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("web_kit_items")
    .select("kit:web_kits(name, name_fr)")
    .eq("web_product_id", webProductId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    kit:
      { name: string; name_fr: string | null } | { name: string; name_fr: string | null }[] | null;
  }[];
  return rows
    .map((r) => (Array.isArray(r.kit) ? r.kit[0] : r.kit))
    .filter((k): k is { name: string; name_fr: string | null } => !!k)
    .map((k) => (k.name_fr ?? "").trim() || k.name);
}

export async function updateWebProduct(id: string, patch: WebProductPatch): Promise<void> {
  const { error } = await supabase.from("web_products").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export function setPublished(id: string, published: boolean): Promise<void> {
  return updateWebProduct(id, { published });
}

// Linking never touches the typed price. Unlinking puts the stock back on
// manual in the same update (the table forbids 'auto' without a link).
export async function linkWebProduct(id: string, productId: string | null): Promise<void> {
  const update =
    productId === null
      ? { product_id: null, stock_mode: "manual" as const }
      : { product_id: productId };
  const { error } = await supabase.from("web_products").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

// Inserts at the end of the owner's order: the feed sorts by `sort`, and the
// default 0 would put a new product first on the site.
export async function createWebProduct(input: NewWebProduct): Promise<string> {
  const [{ data: ids, error: idError }, { data: last, error: sortError }] = await Promise.all([
    supabase
      .from("web_products")
      .select("id")
      .range(0, PAGE * 5 - 1),
    supabase.from("web_products").select("sort").order("sort", { ascending: false }).limit(1),
  ]);
  if (idError) throw new Error(idError.message);
  if (sortError) throw new Error(sortError.message);
  const id = nextWebId(((ids ?? []) as { id: string }[]).map((r) => r.id));
  const sort = ((last ?? []) as { sort: number }[])[0]?.sort ?? -1;
  const { error } = await supabase.from("web_products").insert({
    id,
    product_id: input.product_id,
    name: input.name,
    name_fr: input.name_fr,
    category_id: input.category_id,
    price_cents: input.price_cents ?? null,
    stock_mode: "manual",
    manual_in_stock: true,
    published: false,
    sort: sort + 1,
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function deleteWebProduct(id: string): Promise<void> {
  const { error } = await supabase.from("web_products").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
