// Data access for the owner's "Boutique en ligne" section. Owner only: RLS on
// the web_* tables refuses anyone else. Reads the base `products` table (the
// owner may see stock and prices), never the cashier view.
//
// Changing the app price of a linked product goes through applyWebPrice()
// below: one undoable batch whose UPDATE the selling_price_history trigger
// (migration 027) records.
import { fetchProductMarginFloor } from "@/src/lib/competitors/queries";
import { supabase } from "@/src/lib/supabase/client";
import { minMarginBpFor } from "./priceMargin";
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

const APP_COLUMNS = "id, name, selling_price_cents, stock_quantity, active, kind, photo_path";

const WEB_COLUMNS =
  "id, product_id, name, name_fr, size, category_id, sub_code, popular, keywords, image_url, image_path, image_source, price_cents, stock_mode, manual_in_stock, published, sort";

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

// Sets the app price of a linked product as ONE batch (source 'webstore'), so
// undoPriceChange(batchId) puts the old price back. changed 0 (and no batch)
// when the product already has this price.
export async function applyWebPrice(
  productId: string,
  priceCents: number
): Promise<{ batchId: string | null; changed: number }> {
  const { data, error } = await supabase.rpc("apply_webstore_price", {
    p_product_id: productId,
    p_price_cents: priceCents,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { batch_id?: unknown; changed?: unknown };
  const changed = Number(result.changed);
  return {
    batchId: typeof result.batch_id === "string" ? result.batch_id : null,
    changed: Number.isFinite(changed) ? changed : 0,
  };
}

// What the margin check needs about an app product: its cost (null = none
// recorded) and the minimum margin that applies, the same one the competitor
// prices use (product override, else the store-wide setting).
export async function fetchProductMarginInfo(
  productId: string
): Promise<{ costCents: number | null; minMarginBp: number }> {
  const [cost, floor] = await Promise.all([
    supabase.from("products").select("current_cost_cents").eq("id", productId).maybeSingle(),
    fetchProductMarginFloor(productId),
  ]);
  if (cost.error) throw new Error(cost.error.message);
  const raw = (cost.data as { current_cost_cents?: unknown } | null)?.current_cost_cents;
  const value = raw === null || raw === undefined ? null : Number(raw);
  return {
    costCents: value !== null && Number.isFinite(value) && value > 0 ? value : null,
    minMarginBp: minMarginBpFor(floor.override, floor.storePercent),
  };
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
