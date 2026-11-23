import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  afterPage,
  catalogPageUrl,
  classifyCatalogResponse,
  normalizeShopUrl,
  ownerReadAllowed,
  parseCatalogPage,
  readTotals,
  shopIsDue,
  shopStateAfterFailure,
  type CatalogItem,
} from "../_shared/competitorParse.ts";
import { matchCatalog } from "../_shared/competitorMatch.ts";
import { corsHeaders, createPoliteFetcher, sameSecret, textOf } from "../_shared/politeFetch.ts";

// Reads a competitor shop's public WooCommerce catalogue (Store API) slowly and
// keeps only facts. Callers:
//   (a) the owner, with their session:
//         { action: "add", url, name? }   validate a shop, add it, start reading
//         { action: "read", shopId }      "Lire maintenant" (continues a read, or
//                                         starts one at most once an hour)
//         { action: "rematch", shopId? }  recompute the proposals; no request to any shop
//   (b) the weekly job (pg_cron + pg_net), header x-cron-secret equal to the
//       COMPETITOR_CHECK_SECRET function secret: continues or starts the read of
//       every shop that is due, one after the other.
// Rules, in code below: robots.txt first (our agent's group AND `*`); honest
// User-Agent; at least 3 s between requests to a shop; a 401/403/429/451 or a bot
// challenge stops the read and marks the shop `refused`, never retried by the job
// and never worked around; a read that runs out of time (~110 s) stores the next
// page on the shop and the next call continues there; items not seen in a
// complete read are marked gone, never deleted.

const response = (status: number, body: object) => Response.json(body, { status, headers: corsHeaders });

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceRole);

const GAP_MS = 3000;
const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 12_000_000;
const BUDGET_MS = 110_000;
// Stop starting pages when less than this remains (a page + the gap + saving + matching).
const RESERVE_MS = 25_000;
const LEASE_MS = 4 * 60 * 1000;
const CHUNK = 100;

type Shop = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  next_page: number | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  sync_claimed_at: string | null;
};
const SHOP_COLUMNS = "id,name,base_url,status,next_page,last_sync_started_at,last_sync_completed_at,sync_claimed_at";

type ReadOutcome =
  | { status: "ok"; items: number }
  | { status: "syncing"; nextPage: number }
  | { status: "refused" | "error" | "not_woocommerce" | "currency_not_mad"; detail: string };

// ---- one page --------------------------------------------------------------

type PageResult =
  | { kind: "ok"; items: CatalogItem[]; totalPages: number | null; totalItems: number | null }
  | { kind: "refused" | "error" | "not_woocommerce" | "currency_not_mad"; detail: string };

async function fetchPage(
  fetcher: ReturnType<typeof createPoliteFetcher>,
  origin: string,
  page: number
): Promise<PageResult> {
  const res = await fetcher.get(catalogPageUrl(origin, page), "application/json");
  if (res.kind === "refused") return { kind: "refused", detail: res.detail };
  if (res.kind === "disallowed") return { kind: "refused", detail: "robots_disallow" };
  if (res.kind === "error") return { kind: "error", detail: res.detail };
  if (res.tooLarge) return { kind: "error", detail: "too_large" };
  const verdict = classifyCatalogResponse(res.status, textOf(res.bytes));
  if (verdict.kind === "refused") return { kind: "refused", detail: verdict.detail };
  if (verdict.kind === "not_woocommerce") {
    return page === 1 ? { kind: "not_woocommerce", detail: "not_woocommerce" } : { kind: "error", detail: "http_404" };
  }
  if (verdict.kind === "error") return { kind: "error", detail: verdict.detail };
  const parsed = parseCatalogPage(verdict.json, page);
  if (!parsed.ok) return { kind: parsed.detail, detail: parsed.detail };
  const totals = readTotals(res.headers);
  return { kind: "ok", items: parsed.items, totalPages: totals.totalPages, totalItems: totals.totalItems };
}

// ---- reading a shop ---------------------------------------------------------

async function claim(shopId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
  const { data, error } = await admin.from("competitor_shops")
    .update({ sync_claimed_at: new Date().toISOString() })
    .eq("id", shopId)
    .or(`sync_claimed_at.is.null,sync_claimed_at.lt.${cutoff}`)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

async function setShop(shopId: string, values: Record<string, unknown>) {
  const { error } = await admin.from("competitor_shops").update(values).eq("id", shopId);
  if (error) throw new Error(`save_shop_failed: ${error.message}`);
}

async function storeItems(shopId: string, items: CatalogItem[]) {
  for (let i = 0; i < items.length; i += CHUNK) {
    const { error } = await admin.rpc("upsert_competitor_catalog_items", {
      p_shop_id: shopId,
      p_items: items.slice(i, i + CHUNK),
    });
    if (error) throw new Error(`save_items_failed: ${error.message}`);
  }
}

// Reads pages of `shop` until the catalogue is complete or the time is up.
// `prefetched` is a page-1 answer already obtained (adding a shop).
async function readShop(
  shop: Shop,
  fetcher: ReturnType<typeof createPoliteFetcher>,
  deadline: number,
  startNew: boolean,
  prefetched?: PageResult
): Promise<ReadOutcome> {
  const origin = new URL(shop.base_url).origin;
  let page = startNew ? 1 : (shop.next_page ?? 1);
  try {
    if (startNew) {
      // The start time is stamped by the database clock (see the SQL function).
      const { error } = await admin.rpc("start_competitor_shop_read", { p_shop_id: shop.id });
      if (error) throw new Error(`start_failed: ${error.message}`);
    } else {
      await setShop(shop.id, { status: "syncing", status_detail: null });
    }
    let total: number | null = null;
    for (;;) {
      let result: PageResult;
      if (prefetched && page === 1) {
        result = prefetched;
        prefetched = undefined;
      } else {
        if (Date.now() > deadline - RESERVE_MS) {
          await setShop(shop.id, { status: "syncing", next_page: page, sync_claimed_at: null });
          return { status: "syncing", nextPage: page };
        }
        result = await fetchPage(fetcher, origin, page);
      }
      if (result.kind !== "ok") {
        // A refusal ends the read for good (the owner can retry later); other
        // failures keep next_page so the next call continues here.
        await setShop(shop.id, {
          ...shopStateAfterFailure(result.kind, result.detail, page),
          sync_claimed_at: null,
        });
        return { status: result.kind, detail: result.detail };
      }
      await storeItems(shop.id, result.items);
      total = result.totalItems ?? total;
      const step = afterPage({ page, itemCount: result.items.length, totalPages: result.totalPages });
      if (step.done) {
        const { data, error } = await admin.rpc("finish_competitor_shop_read", { p_shop_id: shop.id });
        if (error) throw new Error(`finish_failed: ${error.message}`);
        await runMatching(shop.id).catch((e) =>
          console.error("sync-competitor-shop matching failed", { shop: shop.id, message: String(e).slice(0, 300) }));
        return { status: "ok", items: typeof data === "number" ? data : (total ?? 0) };
      }
      page = step.nextPage;
      await setShop(shop.id, { next_page: page, total_items: total });
    }
  } catch (error) {
    console.error("sync-competitor-shop failed", { shop: shop.id, message: String(error).slice(0, 300) });
    await setShop(shop.id, { status: "error", status_detail: "unexpected", sync_claimed_at: null }).catch(() => {});
    return { status: "error", detail: "unexpected" };
  }
}

// ---- matching -----------------------------------------------------------------

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

// Proposes our products for the shop's items nobody decided on. Never touches an
// item the owner decided, never proposes a product already matched in the shop.
async function runMatching(shopId: string): Promise<number> {
  const items = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin.from("competitor_catalog_items").select("id,name")
      .eq("shop_id", shopId).eq("gone", false)
      .in("decision", ["undecided", "proposed", "missing"]).is("decided_by", null)
      .order("id").range(from, to));
  const products = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin.from("products").select("id,name").eq("active", true).order("id").range(from, to));
  const matched = await fetchAll<{ matched_product_id: string }>((from, to) =>
    admin.from("competitor_catalog_items").select("matched_product_id")
      .eq("shop_id", shopId).eq("decision", "matched").not("matched_product_id", "is", null)
      .order("id").range(from, to));
  const results = matchCatalog(items, products, new Set(matched.map((m) => m.matched_product_id)));
  const rows = results.map((r) => ({ item_id: r.itemId, product_id: r.productId, score: r.score, uncertain: r.uncertain }));
  if (rows.length === 0) {
    // Still reset stale proposals (their items may have been decided meanwhile: no-op then).
    await admin.rpc("apply_competitor_matches", { p_shop_id: shopId, p_rows: [], p_reset: true });
    return 0;
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.rpc("apply_competitor_matches", {
      p_shop_id: shopId, p_rows: rows.slice(i, i + 500), p_reset: i === 0,
    });
    if (error) throw new Error(`apply_matches_failed: ${error.message}`);
  }
  return rows.filter((r) => r.product_id).length;
}

// ---- one shop, start to finish (lease included) -------------------------------

async function runShop(shop: Shop, deadline: number, startNew: boolean): Promise<ReadOutcome | { status: "busy" }> {
  if (!(await claim(shop.id))) return { status: "busy" };
  const outcome = await readShop(shop, createPoliteFetcher({ gapMs: GAP_MS, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BODY_BYTES }), deadline, startNew);
  // The lease is released by readShop on every path except a finished read, which
  // finish_competitor_shop_read releases; make sure of it.
  await admin.from("competitor_shops").update({ sync_claimed_at: null }).eq("id", shop.id);
  return outcome;
}

// ---- adding a shop -------------------------------------------------------------

function defaultName(host: string): string {
  const label = host.replace(/^www\./, "").split(".")[0] ?? host;
  return (label.charAt(0).toUpperCase() + label.slice(1)).slice(0, 60);
}

async function addShop(body: Record<string, unknown>, deadline: number, userId: string) {
  const normalized = typeof body.url === "string" ? normalizeShopUrl(body.url) : { ok: false as const, reason: "invalid_url" as const };
  if (!normalized.ok) return response(200, { status: "rejected", reason: normalized.reason });
  const name = (typeof body.name === "string" && body.name.trim() ? body.name.trim() : defaultName(normalized.host)).slice(0, 60);

  const { data: existing } = await admin.from("competitor_shops").select("id").eq("base_url", normalized.origin).maybeSingle();
  if (existing) return response(200, { status: "rejected", reason: "already_added", shopId: existing.id });

  const fetcher = createPoliteFetcher({ gapMs: GAP_MS, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BODY_BYTES });
  const first = await fetchPage(fetcher, normalized.origin, 1);
  if (first.kind !== "ok") {
    return response(200, { status: "rejected", reason: first.kind === "error" ? first.detail : first.kind === "refused" ? first.detail : first.kind });
  }
  if (first.items.length === 0) return response(200, { status: "rejected", reason: "empty_catalogue" });
  if (first.items.every((item) => item.price_cents === null)) return response(200, { status: "rejected", reason: "no_prices" });

  const { data: shop, error } = await admin.from("competitor_shops")
    .insert({ name, base_url: normalized.origin, platform: "woocommerce", status: "syncing", created_by: userId })
    .select(SHOP_COLUMNS).single();
  if (error) {
    return response(200, { status: "rejected", reason: error.code === "23505" ? "already_added" : "save_failed" });
  }
  if (!(await claim(shop.id))) return response(200, { status: "added", shopId: shop.id, read: "busy" });
  const outcome = await readShop(shop as Shop, fetcher, deadline, true, first);
  await admin.from("competitor_shops").update({ sync_claimed_at: null }).eq("id", shop.id);
  return response(200, { status: "added", shopId: shop.id, read: outcome });
}

// ---- entry point -----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "method" });
  const deadline = Date.now() + BUDGET_MS;

  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader !== null) {
    const secret = Deno.env.get("COMPETITOR_CHECK_SECRET");
    if (!secret || !sameSecret(cronHeader, secret)) return response(401, { error: "secret" });
    const { data: shops, error } = await admin.from("competitor_shops").select(SHOP_COLUMNS).order("last_sync_completed_at", { ascending: true, nullsFirst: true });
    if (error) return response(503, { error: "temporarily_unavailable" });
    const counts: Record<string, number> = {};
    for (const shop of (shops ?? []) as Shop[]) {
      if (Date.now() > deadline - RESERVE_MS) break;
      if (!shopIsDue(shop, Date.now())) continue;
      const outcome = await runShop(shop, deadline, shop.next_page === null);
      counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    }
    return response(200, { counts });
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "session" });
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return response(401, { error: "session" });
  const { data: owner, error: ownerError } = await caller.rpc("is_owner");
  if (ownerError?.code === "PT403") return response(403, { error: "account_deactivated", code: "PT403" });
  if (owner !== true) return response(403, { error: "owner_only" });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action === "add") {
    return await addShop(body!, deadline, auth.user.id);
  }

  const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (action === "rematch") {
    const wanted = body?.shopId;
    if (wanted !== undefined && (typeof wanted !== "string" || !idPattern.test(wanted))) return response(400, { error: "invalid_shop" });
    const query = admin.from("competitor_shops").select("id");
    const { data: shops, error } = await (typeof wanted === "string" ? query.eq("id", wanted) : query);
    if (error) return response(503, { error: "temporarily_unavailable" });
    let proposed = 0;
    try {
      for (const shop of shops ?? []) proposed += await runMatching(shop.id);
    } catch (e) {
      console.error("sync-competitor-shop rematch failed", String(e).slice(0, 300));
      return response(503, { error: "temporarily_unavailable" });
    }
    return response(200, { status: "ok", proposed });
  }

  if (action === "read") {
    const shopId = body?.shopId;
    if (typeof shopId !== "string" || !idPattern.test(shopId)) return response(400, { error: "invalid_shop" });
    const { data: shop, error } = await admin.from("competitor_shops").select(SHOP_COLUMNS).eq("id", shopId).maybeSingle();
    if (error) return response(503, { error: "temporarily_unavailable" });
    if (!shop) return response(404, { error: "not_found" });
    const allowed = ownerReadAllowed(shop as Shop, Date.now());
    if (!allowed.ok) return response(429, { error: "too_soon", retry_after_seconds: allowed.retryAfterSeconds });
    const outcome = await runShop(shop as Shop, deadline, !allowed.resume);
    if (outcome.status === "busy") return response(409, { error: "busy" });
    return response(200, outcome);
  }
  return response(400, { error: "invalid_action" });
});
