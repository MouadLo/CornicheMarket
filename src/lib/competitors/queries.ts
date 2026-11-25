import { manualPointChanged } from "@/src/lib/competitors/link";
import type { OverviewRow } from "@/src/lib/competitors/overview";
import type { CheckResult, StoredPoint } from "@/src/lib/competitors/types";
import { supabase } from "@/src/lib/supabase/client";

// Owner only, everywhere: the tables and functions refuse anyone else (RLS and
// 42501), so a cashier session gets nothing back.

// One row per link, with the latest reading. Without a product: every active
// product that has links (the price-check screen).
export async function fetchCompetitorRows(productId?: string): Promise<OverviewRow[]> {
  const { data, error } = await supabase.rpc("competitor_price_overview", {
    p_product_id: productId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as OverviewRow[];
}

// The function answers a refusal with a non-2xx status and { error } in the body.
async function readFailure(error: { message: string; context?: unknown }) {
  const context = error.context as { status?: number; json?: () => Promise<unknown> } | undefined;
  let body: { error?: unknown; retry_after_seconds?: unknown } | undefined;
  try {
    body = (await context?.json?.()) as typeof body;
  } catch {
    body = undefined;
  }
  return { status: context?.status, body, message: error.message };
}

// Asks the edge function to read the link now (it keeps its own 10-minute
// limit per link). Never throws for a site that refuses: that is a result.
export async function checkCompetitorLink(linkId: string, retry = false): Promise<CheckResult> {
  const { data, error } = await supabase.functions.invoke("check-competitor-prices", {
    body: { linkId, retry },
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
    if (failure.status === 403 || failure.status === 401) throw new Error("owner only");
    return { status: "error", detail: "network" };
  }
  return data as CheckResult;
}

// Adds a link, then reads it once straight away so the owner can confirm it is
// the right product. The link exists even when that first reading fails.
export async function addCompetitorLink(
  productId: string,
  shopName: string,
  url: string
): Promise<{ linkId: string; check: CheckResult }> {
  const { data, error } = await supabase
    .from("competitor_links")
    .insert({ product_id: productId, shop_name: shopName, url, mode: "auto" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const linkId = (data as { id: string }).id;
  const check = await checkCompetitorLink(linkId).catch((): CheckResult => ({
    status: "error",
    detail: "network",
  }));
  return { linkId, check };
}

export async function removeCompetitorLink(linkId: string): Promise<void> {
  const { error } = await supabase.from("competitor_links").delete().eq("id", linkId);
  if (error) throw new Error(error.message);
}

// The owner types what the shop shows. A price point is stored only when the
// price or the stock changed; the link is stamped "checked now" either way.
// The title and photo found earlier are kept on the new point.
export async function saveManualPrice(
  linkId: string,
  input: { priceCents: number | null; inStock: boolean }
): Promise<void> {
  const { data: latest, error: readError } = await supabase
    .from("competitor_price_points")
    .select("price_cents, regular_price_cents, in_stock, title, image_url")
    .eq("link_id", linkId)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const previous = (latest ?? null) as
    (StoredPoint & { title: string | null; image_url: string | null }) | null;

  if (manualPointChanged(previous, input)) {
    const { data: session } = await supabase.auth.getSession();
    const { error } = await supabase.from("competitor_price_points").insert({
      link_id: linkId,
      price_cents: input.priceCents,
      regular_price_cents: input.priceCents,
      on_sale: false,
      in_stock: input.inStock,
      title: previous?.title ?? null,
      image_url: previous?.image_url ?? null,
      source: "manual",
      entered_by: session.session?.user.id ?? null,
    });
    if (error) throw new Error(error.message);
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("competitor_links")
    .update({ last_checked_at: now, last_ok_at: now, last_status: "manual", mode: "manual" })
    .eq("id", linkId);
  if (error) throw new Error(error.message);
}

// ---- minimum margin (owner only) ----

export async function fetchStoreMinMargin(): Promise<number> {
  const { data, error } = await supabase
    .from("owner_settings")
    .select("competitor_min_margin_percent")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = Number(
    (data as { competitor_min_margin_percent?: unknown } | null)?.competitor_min_margin_percent
  );
  return Number.isFinite(value) ? value : 15;
}

export async function updateStoreMinMargin(percent: number): Promise<void> {
  const { error } = await supabase
    .from("owner_settings")
    .update({ competitor_min_margin_percent: percent })
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

// null removes the override (the store-wide margin applies again).
export async function setProductMarginFloor(
  productId: string,
  percent: number | null
): Promise<void> {
  if (percent === null) {
    const { error } = await supabase
      .from("product_margin_floors")
      .delete()
      .eq("product_id", productId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("product_margin_floors")
    .upsert({ product_id: productId, min_margin_percent: percent }, { onConflict: "product_id" });
  if (error) throw new Error(error.message);
}

// ---- applying suggestions ----

// Changes the selling prices of one or several products as ONE batch, through the
// same tables as the percent change, so "Annuler" in Recent price changes (and
// undoPriceChange) puts the old prices back. Returns the batch (null when no
// price actually moved).
export async function applyCompetitorSuggestions(
  items: { productId: string; priceCents: number }[]
): Promise<{ batchId: string | null; changed: number }> {
  const { data, error } = await supabase.rpc("apply_competitor_price_suggestions", {
    p_items: items.map((item) => ({
      product_id: item.productId,
      selling_price_cents: item.priceCents,
    })),
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { batch_id?: string | null; changed?: number };
  return { batchId: result.batch_id ?? null, changed: result.changed ?? 0 };
}

// The product's own minimum margin (null = none: the store margin applies) and
// the store-wide one, for the product edit screen.
export async function fetchProductMarginFloor(
  productId: string
): Promise<{ override: number | null; storePercent: number }> {
  const [floor, storePercent] = await Promise.all([
    supabase
      .from("product_margin_floors")
      .select("min_margin_percent")
      .eq("product_id", productId)
      .maybeSingle(),
    fetchStoreMinMargin(),
  ]);
  if (floor.error) throw new Error(floor.error.message);
  const raw = (floor.data as { min_margin_percent?: unknown } | null)?.min_margin_percent;
  return { override: raw === undefined || raw === null ? null : Number(raw), storePercent };
}

// Tags (or untags) a "produit repère": a product customers know the price of.
// Owner only: the column grant and the products policy refuse anyone else.
export async function setPriceCheck(productId: string, priceCheck: boolean): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ price_check: priceCheck })
    .eq("id", productId);
  if (error) throw new Error(error.message);
}
