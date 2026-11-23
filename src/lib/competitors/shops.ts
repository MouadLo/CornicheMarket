import type {
  CatalogRow,
  CatalogView,
  ListFilters,
  ShopRow,
  SourcingStatus,
} from "@/src/lib/competitors/catalog";
import { PAGE_SIZE } from "@/src/lib/competitors/catalog";
import { supabase } from "@/src/lib/supabase/client";

// Owner only, everywhere: the tables and functions refuse anyone else (RLS and
// 42501), so a cashier session gets nothing back. Shops are created and read by
// the sync-competitor-shop edge function; decisions go through SQL functions.

type InvokeError = { message: string; context?: unknown };

async function readFailure(error: InvokeError) {
  const context = error.context as { status?: number; json?: () => Promise<unknown> } | undefined;
  let body: { error?: unknown; retry_after_seconds?: unknown } | undefined;
  try {
    body = (await context?.json?.()) as typeof body;
  } catch {
    body = undefined;
  }
  return { status: context?.status, body };
}

// ---- reading the lists ----

export async function fetchShops(): Promise<ShopRow[]> {
  const { data, error } = await supabase.rpc("competitor_shop_overview");
  if (error) throw new Error(error.message);
  return (data ?? []) as ShopRow[];
}

export type CatalogCounts = { proposed: number; missing: number; wanted: number };

export async function fetchCatalogCounts(): Promise<CatalogCounts> {
  const { data, error } = await supabase.rpc("competitor_catalog_counts");
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Partial<CatalogCounts> | null;
  return {
    proposed: Number(row?.proposed ?? 0),
    missing: Number(row?.missing ?? 0),
    wanted: Number(row?.wanted ?? 0),
  };
}

export async function fetchCatalogPage(
  view: CatalogView,
  filters: ListFilters,
  offset: number
): Promise<CatalogRow[]> {
  const { data, error } = await supabase.rpc("competitor_catalog_page", {
    p_view: view,
    p_shop: filters.shopId,
    p_category: filters.category,
    p_in_stock_only: filters.inStockOnly,
    p_promo_only: filters.promoOnly,
    p_sort: view === "proposed" ? "score" : view === "wanted" ? "decided" : filters.sort,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CatalogRow[]).map((row) => ({
    ...row,
    total_count: Number(row.total_count),
  }));
}

export async function fetchCatalogCategories(
  view: CatalogView,
  shopId: string | null
): Promise<string[]> {
  const { data, error } = await supabase.rpc("competitor_catalog_categories", {
    p_view: view,
    p_shop: shopId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { category: string }[]).map((row) => row.category);
}

// ---- decisions ----

// Confirms the pair: creates the phase 1 link and its first price point.
export async function confirmMatch(itemId: string, productId: string): Promise<string> {
  const { data, error } = await supabase.rpc("confirm_competitor_match", {
    p_item_id: itemId,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function rejectMatch(itemId: string): Promise<void> {
  const { error } = await supabase.rpc("reject_competitor_match", { p_item_id: itemId });
  if (error) throw new Error(error.message);
}

export type ItemDecision = "wanted" | "ignored" | "missing";

export async function setItemDecision(itemId: string, decision: ItemDecision): Promise<void> {
  const { error } = await supabase.rpc("set_competitor_item_decision", {
    p_item_id: itemId,
    p_decision: decision,
  });
  if (error) throw new Error(error.message);
}

export async function updateSourcing(
  itemId: string,
  input: { note: string | null; supplierId: string | null; status: SourcingStatus }
): Promise<void> {
  const { error } = await supabase.rpc("update_competitor_sourcing", {
    p_item_id: itemId,
    p_note: input.note,
    p_supplier_id: input.supplierId,
    p_status: input.status,
  });
  if (error) throw new Error(error.message);
}

// ---- shops (the edge function) ----

export type AddShopResult =
  | { status: "added"; shopId: string; read?: ReadResult }
  | { status: "rejected"; reason: string; shopId?: string };

export type ReadResult =
  | { status: "ok"; items: number }
  | { status: "syncing"; nextPage: number }
  | { status: "busy" }
  | { status: "rate_limited"; retryAfterSeconds?: number }
  | { status: "refused" | "error" | "not_woocommerce" | "currency_not_mad"; detail?: string };

export async function addShop(url: string, name: string): Promise<AddShopResult> {
  const { data, error } = await supabase.functions.invoke("sync-competitor-shop", {
    body: { action: "add", url, name: name.trim() || undefined },
  });
  if (error) {
    const failure = await readFailure(error);
    if (failure.status === 403 || failure.status === 401) throw new Error("owner only");
    return { status: "rejected", reason: "network" };
  }
  return data as AddShopResult;
}

// "Lire maintenant". A read that runs out of time answers `syncing` with the
// page it stopped at; the call is repeated (the function continues there).
export async function readShopNow(
  shopId: string,
  onProgress?: (nextPage: number) => void,
  maxCalls = 12
): Promise<ReadResult> {
  let last: ReadResult = { status: "error", detail: "network" };
  for (let call = 0; call < maxCalls; call++) {
    const { data, error } = await supabase.functions.invoke("sync-competitor-shop", {
      body: { action: "read", shopId },
    });
    if (error) {
      const failure = await readFailure(error);
      if (failure.status === 429 && failure.body?.error === "too_soon") {
        const wait = Number(failure.body.retry_after_seconds);
        return {
          status: "rate_limited",
          retryAfterSeconds: Number.isFinite(wait) ? wait : undefined,
        };
      }
      if (failure.status === 409) return { status: "busy" };
      if (failure.status === 403 || failure.status === 401) throw new Error("owner only");
      return { status: "error", detail: "network" };
    }
    last = data as ReadResult;
    if (last.status !== "syncing") return last;
    onProgress?.(last.nextPage);
  }
  return last;
}

// "Recalculer les correspondances": no request is made to any shop.
export async function rematch(shopId?: string): Promise<number> {
  const { data, error } = await supabase.functions.invoke("sync-competitor-shop", {
    body: shopId ? { action: "rematch", shopId } : { action: "rematch" },
  });
  if (error) {
    const failure = await readFailure(error);
    if (failure.status === 403 || failure.status === 401) throw new Error("owner only");
    throw new Error("network request failed");
  }
  return Number((data as { proposed?: number } | null)?.proposed ?? 0);
}

// Deletes the shop and its items; the links already confirmed stay.
export async function deleteShop(shopId: string): Promise<void> {
  const { error } = await supabase.from("competitor_shops").delete().eq("id", shopId);
  if (error) throw new Error(error.message);
}

// ---- photos ----

export type ImageResult =
  | { status: "ok"; contentType: string; extension: string; base64: string }
  | { status: "refused" | "error"; detail?: string };

// The bytes of a photo whose URL is already in our database (never an arbitrary
// URL: the function refuses anything else).
export async function fetchCompetitorImage(imageUrl: string): Promise<ImageResult> {
  const { data, error } = await supabase.functions.invoke("competitor-image", {
    body: { url: imageUrl },
  });
  if (error) {
    const failure = await readFailure(error);
    if (failure.status === 403 || failure.status === 401) throw new Error("owner only");
    return { status: "error", detail: "network" };
  }
  return data as ImageResult;
}
