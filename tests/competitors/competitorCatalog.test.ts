import {
  afterPage,
  catalogPageUrl,
  CATALOG_MAX_PAGES,
  CATALOG_PER_PAGE,
  classifyCatalogResponse,
  imageExtension,
  isAllowedImageType,
  isPrivateHost,
  normalizeShopUrl,
  ownerReadAllowed,
  parseCatalogPage,
  popularityRank,
  readTotals,
  robotsAllowsCatalog,
  shopStateAfterFailure,
  shopIsDue,
  SHOP_MIN_READ_GAP_MS,
  SHOP_WEEKLY_GAP_MS,
  STORE_API_PATH,
  USER_AGENT,
} from "../../supabase/functions/_shared/competitorParse";

const product = (over: Record<string, unknown> = {}) => ({
  id: 101,
  name: "Lorenz Crunchips Paprika &#8211; 100g",
  permalink: "https://yournightshop.ma/produit/crunchips/",
  sku: "",
  is_in_stock: true,
  low_stock_remaining: null,
  prices: {
    price: "1500",
    regular_price: "1500",
    sale_price: "1500",
    currency_code: "MAD",
    currency_minor_unit: 2,
  },
  images: [{ src: "https://yournightshop.ma/wp-content/a.jpg" }],
  categories: [{ id: 1, name: "Chips &amp; Snacks", slug: "chips" }],
  ...over,
});
const ok = (r: ReturnType<typeof parseCatalogPage>) => {
  if (!r.ok) throw new Error(r.detail);
  return r;
};

describe("parseCatalogPage", () => {
  it("parses facts, decodes entities and converts minor units to centimes", () => {
    const { items } = ok(parseCatalogPage([product()], 1));
    expect(items).toEqual([
      {
        external_id: "101",
        name: "Lorenz Crunchips Paprika – 100g",
        url: "https://yournightshop.ma/produit/crunchips/",
        price_cents: 1500,
        regular_price_cents: 1500,
        on_sale: false,
        in_stock: true,
        low_stock_remaining: null,
        image_url: "https://yournightshop.ma/wp-content/a.jpg",
        categories: ["Chips & Snacks"],
        popularity_rank: 1,
      },
    ]);
  });
  it("keeps no description or other field", () => {
    const { items } = ok(
      parseCatalogPage([product({ description: "<p>long</p>", short_description: "x" })], 1)
    );
    expect(Object.keys(items[0]).sort()).toEqual(
      [
        "categories",
        "external_id",
        "image_url",
        "in_stock",
        "low_stock_remaining",
        "name",
        "on_sale",
        "popularity_rank",
        "price_cents",
        "regular_price_cents",
        "url",
      ].sort()
    );
  });
  it("detects a promo", () => {
    const { items } = ok(
      parseCatalogPage(
        [
          product({
            prices: {
              price: "1200",
              regular_price: "1500",
              sale_price: "1200",
              currency_code: "MAD",
              currency_minor_unit: 2,
            },
          }),
        ],
        1
      )
    );
    expect(items[0]).toMatchObject({ price_cents: 1200, regular_price_cents: 1500, on_sale: true });
  });
  it("handles other minor units", () => {
    const { items } = ok(
      parseCatalogPage(
        [
          product({
            prices: {
              price: "15",
              regular_price: "15",
              currency_code: "MAD",
              currency_minor_unit: 0,
            },
          }),
        ],
        1
      )
    );
    expect(items[0].price_cents).toBe(1500);
    const three = ok(
      parseCatalogPage(
        [
          product({
            prices: {
              price: "15000",
              regular_price: "15000",
              currency_code: "MAD",
              currency_minor_unit: 3,
            },
          }),
        ],
        1
      )
    );
    expect(three.items[0].price_cents).toBe(1500);
  });
  it("handles a missing image and no categories", () => {
    const { items } = ok(parseCatalogPage([product({ images: [], categories: undefined })], 1));
    expect(items[0].image_url).toBeNull();
    expect(items[0].categories).toEqual([]);
    expect(ok(parseCatalogPage([product({ images: undefined })], 1)).items[0].image_url).toBeNull();
  });
  it("out of stock and low stock", () => {
    const { items } = ok(
      parseCatalogPage(
        [product({ is_in_stock: false }), product({ id: 2, low_stock_remaining: 3 })],
        1
      )
    );
    expect(items[0].in_stock).toBe(false);
    expect(items[1].low_stock_remaining).toBe(3);
  });
  it("an item without a price is kept (price null)", () => {
    const { items } = ok(
      parseCatalogPage(
        [
          product({
            prices: {
              price: "0",
              regular_price: "0",
              currency_code: "MAD",
              currency_minor_unit: 2,
            },
          }),
        ],
        1
      )
    );
    expect(items[0].price_cents).toBeNull();
    expect(items[0].on_sale).toBe(false);
  });
  it("ranks by position across pages", () => {
    const a = ok(parseCatalogPage([product({ id: 1 }), product({ id: 2 })], 1)).items;
    const b = ok(parseCatalogPage([product({ id: 3 }), product({ id: 4 })], 3)).items;
    expect(a.map((i) => i.popularity_rank)).toEqual([1, 2]);
    expect(b.map((i) => i.popularity_rank)).toEqual([201, 202]);
    expect(popularityRank(2, 0)).toBe(101);
  });
  it("skips broken items and counts them", () => {
    const r = ok(
      parseCatalogPage(
        [
          product(),
          { id: 5 },
          null,
          product({ id: 6, permalink: "http://x.ma/p" }),
          product({ id: 7, name: "  " }),
        ],
        1
      )
    );
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toBe(4);
  });
  it("refuses a shop that is not in dirhams", () => {
    const eur = product({
      prices: {
        price: "1500",
        regular_price: "1500",
        currency_code: "EUR",
        currency_minor_unit: 2,
      },
    });
    expect(parseCatalogPage([eur], 1)).toEqual({ ok: false, detail: "currency_not_mad" });
  });
  it("an empty array is an empty page; a non-array is not WooCommerce", () => {
    expect(parseCatalogPage([], 1)).toEqual({ ok: true, items: [], skipped: 0 });
    expect(parseCatalogPage({ code: "rest_no_route" }, 1)).toEqual({
      ok: false,
      detail: "not_woocommerce",
    });
  });
  it("decodes double-encoded entities and strips tags from the name", () => {
    const { items } = ok(parseCatalogPage([product({ name: "Biscuit &amp;#8211; <b>Lu</b>" })], 1));
    expect(items[0].name).toBe("Biscuit – Lu");
  });
});

describe("urls", () => {
  it("builds the Store API url", () => {
    expect(catalogPageUrl("https://yournightshop.ma", 3)).toBe(
      "https://yournightshop.ma/wp-json/wc/store/v1/products?per_page=100&page=3&orderby=popularity&order=desc"
    );
  });
  it("normalises a shop url to its origin", () => {
    expect(normalizeShopUrl("yournightshop.ma")).toEqual({
      ok: true,
      origin: "https://yournightshop.ma",
      host: "yournightshop.ma",
    });
    expect(normalizeShopUrl(" HTTPS://YourNightShop.ma/produit/x?y=1 ")).toMatchObject({
      ok: true,
      origin: "https://yournightshop.ma",
    });
  });
  it.each([
    ["http://shop.ma", "not_https"],
    ["", "invalid_url"],
    ["https://user:pw@shop.ma", "invalid_url"],
    ["https://shop.ma:8443", "invalid_url"],
    ["https://127.0.0.1", "private_host"],
    ["https://192.168.1.5/shop", "private_host"],
    ["https://localhost", "private_host"],
    ["https://[::1]", "private_host"],
    ["https://intranet", "private_host"],
    ["https://printer.local", "private_host"],
    ["https://2130706433", "private_host"],
    ["ftp://shop.ma", "not_https"],
  ])("refuses %s", (raw, reason) => {
    expect(normalizeShopUrl(raw)).toEqual({ ok: false, reason });
  });
  it("isPrivateHost", () => {
    expect(isPrivateHost("shop.ma")).toBe(false);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
  });
});

describe("robots for the Store API", () => {
  const path = `${STORE_API_PATH}?per_page=100&page=1&orderby=popularity&order=desc`;
  it("allows when nothing disallows it", () => {
    expect(robotsAllowsCatalog("User-agent: *\nDisallow: /wp-admin/\n", path)).toBe(true);
    expect(robotsAllowsCatalog("", path)).toBe(true);
  });
  it("refuses when * disallows the path", () => {
    expect(robotsAllowsCatalog("User-agent: *\nDisallow: /wp-json/\n", path)).toBe(false);
  });
  it("refuses when our agent's group disallows it even if * allows", () => {
    const txt =
      "User-agent: CornicheMarket-price-check\nDisallow: /wp-json/\n\nUser-agent: *\nAllow: /\n";
    expect(robotsAllowsCatalog(txt, path)).toBe(false);
  });
  it("refuses when * disallows even if our group allows", () => {
    const txt =
      "User-agent: CornicheMarket-price-check\nAllow: /\n\nUser-agent: *\nDisallow: /wp-json/\n";
    expect(robotsAllowsCatalog(txt, path)).toBe(false);
  });
  it("honours a more specific Allow", () => {
    const txt = "User-agent: *\nDisallow: /wp-json/\nAllow: /wp-json/wc/store/\n";
    expect(robotsAllowsCatalog(txt, path)).toBe(true);
  });
  it("uses an honest user agent", () => {
    expect(USER_AGENT).toBe("Mozilla/5.0 (compatible; CornicheMarket-price-check/1.0)");
  });
});

describe("responses: refusal and not WooCommerce", () => {
  it("a JSON array is ok, even when a product is called Access denied", () => {
    const r = classifyCatalogResponse(200, JSON.stringify([{ name: "Access denied" }]));
    expect(r.kind).toBe("ok");
  });
  it.each([401, 403, 429, 451])("%s is a refusal", (status) => {
    expect(classifyCatalogResponse(status, "")).toEqual({
      kind: "refused",
      detail: `http_${status}`,
    });
  });
  it("a bot challenge page is a refusal", () => {
    expect(classifyCatalogResponse(200, "<html><title>Just a moment...</title>")).toEqual({
      kind: "refused",
      detail: "bot_challenge",
    });
    expect(classifyCatalogResponse(503, "<html>cf-chl</html>").kind).toBe("refused");
  });
  it("404 or html is not WooCommerce; a 500 is an ordinary error", () => {
    expect(classifyCatalogResponse(404, "")).toEqual({ kind: "not_woocommerce" });
    expect(classifyCatalogResponse(200, "<html>hello</html>")).toEqual({ kind: "not_woocommerce" });
    expect(classifyCatalogResponse(200, '{"code":"rest_no_route"}')).toEqual({
      kind: "not_woocommerce",
    });
    expect(classifyCatalogResponse(500, "")).toEqual({ kind: "error", detail: "http_500" });
  });
});

describe("pagination and resume", () => {
  it("reads totals from the headers", () => {
    const headers = new Headers({ "X-WP-Total": "1511", "X-WP-TotalPages": "16" });
    expect(readTotals(headers)).toEqual({ totalPages: 16, totalItems: 1511 });
    expect(readTotals(new Headers())).toEqual({ totalPages: null, totalItems: null });
    expect(readTotals(new Headers({ "X-WP-TotalPages": "abc" })).totalPages).toBeNull();
  });
  it("continues until the last page", () => {
    expect(afterPage({ page: 1, itemCount: 100, totalPages: 16 })).toEqual({
      done: false,
      nextPage: 2,
    });
    expect(afterPage({ page: 15, itemCount: 100, totalPages: 16 })).toEqual({
      done: false,
      nextPage: 16,
    });
    expect(afterPage({ page: 16, itemCount: 11, totalPages: 16 })).toEqual({ done: true });
  });
  it("without a total, a short or empty page ends the read", () => {
    expect(afterPage({ page: 2, itemCount: CATALOG_PER_PAGE, totalPages: null })).toEqual({
      done: false,
      nextPage: 3,
    });
    expect(afterPage({ page: 3, itemCount: 40, totalPages: null })).toEqual({ done: true });
    expect(afterPage({ page: 3, itemCount: 0, totalPages: 9 })).toEqual({ done: true });
  });
  it("is bounded", () => {
    expect(afterPage({ page: CATALOG_MAX_PAGES, itemCount: 100, totalPages: null })).toEqual({
      done: true,
    });
    expect(afterPage({ page: CATALOG_MAX_PAGES, itemCount: 100, totalPages: 500 })).toEqual({
      done: true,
    });
  });
  it("a read split in three invocations visits every page once, in order", () => {
    const totalPages = 16;
    const budgetPages = 6; // pages that fit in one invocation
    const visited: number[] = [];
    let next: number | null = null;
    let invocations = 0;
    for (; invocations < 10; invocations++) {
      let page: number = next ?? 1;
      for (let n = 0; n < budgetPages; n++) {
        visited.push(page);
        const step = afterPage({ page, itemCount: 100, totalPages });
        if (step.done) {
          next = null;
          break;
        }
        page = step.nextPage;
        next = page;
      }
      if (next === null) break;
    }
    expect(visited).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(invocations + 1).toBe(3);
  });
});

describe("when a shop is read", () => {
  const now = Date.parse("2026-11-23T10:00:00Z");
  const shop = (over = {}) => ({
    status: "ok",
    next_page: null as number | null,
    last_sync_started_at: null as string | null,
    last_sync_completed_at: null as string | null,
    ...over,
  });
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("the weekly job reads a never-read shop, an old one, and continues a pending read", () => {
    expect(shopIsDue(shop(), now)).toBe(true);
    expect(shopIsDue(shop({ last_sync_completed_at: ago(7 * 86400000) }), now)).toBe(true);
    expect(shopIsDue(shop({ last_sync_completed_at: ago(SHOP_WEEKLY_GAP_MS - 1000) }), now)).toBe(
      false
    );
    expect(shopIsDue(shop({ next_page: 5, last_sync_completed_at: ago(1000) }), now)).toBe(true);
  });
  it("the weekly job never retries a refused shop", () => {
    expect(shopIsDue(shop({ status: "refused" }), now)).toBe(false);
    expect(shopIsDue(shop({ status: "refused", next_page: 4 }), now)).toBe(false);
  });
  it("Lire maintenant: a new read at most once an hour, a resume always", () => {
    expect(ownerReadAllowed(shop(), now)).toEqual({ ok: true, resume: false });
    expect(
      ownerReadAllowed(shop({ last_sync_started_at: ago(SHOP_MIN_READ_GAP_MS + 1000) }), now)
    ).toEqual({ ok: true, resume: false });
    expect(ownerReadAllowed(shop({ last_sync_started_at: ago(10 * 60000) }), now)).toEqual({
      ok: false,
      retryAfterSeconds: 3000,
    });
    expect(
      ownerReadAllowed(shop({ next_page: 3, last_sync_started_at: ago(10 * 60000) }), now)
    ).toEqual({
      ok: true,
      resume: true,
    });
  });
});

describe("image types", () => {
  it("allows raster images only", () => {
    expect(isAllowedImageType("image/jpeg")).toBe(true);
    expect(isAllowedImageType("IMAGE/PNG")).toBe(true);
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
    expect(isAllowedImageType("text/html")).toBe(false);
    expect(isAllowedImageType("")).toBe(false);
    expect(isAllowedImageType("constructor")).toBe(false);
  });
  it("maps to an extension", () => {
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/unknown")).toBe("jpg");
  });
});

describe("what a failed page does to the shop", () => {
  it("a refusal marks the shop refused and keeps nothing to resume", () => {
    expect(shopStateAfterFailure("refused", "robots_disallow", 5)).toEqual({
      status: "refused",
      status_detail: "robots_disallow",
      next_page: null,
    });
    expect(shopStateAfterFailure("refused", "http_403", 1).next_page).toBeNull();
  });
  it("end to end: a 403, a challenge and a robots Disallow on a page all end up refused", () => {
    const robots = robotsAllowsCatalog(
      "User-agent: *\nDisallow: /wp-json/\n",
      "/wp-json/wc/store/v1/products?page=2"
    );
    expect(robots).toBe(false);
    const fromRobots = shopStateAfterFailure("refused", "robots_disallow", 2);
    const fromForbidden = classifyCatalogResponse(403, "");
    const fromChallenge = classifyCatalogResponse(200, "<title>Just a moment...</title>");
    expect(fromRobots.status).toBe("refused");
    for (const verdict of [fromForbidden, fromChallenge]) {
      expect(verdict.kind).toBe("refused");
      const detail = verdict.kind === "refused" ? verdict.detail : "";
      expect(shopStateAfterFailure("refused", detail, 2).status).toBe("refused");
    }
  });
  it("any other failure keeps the page to resume from", () => {
    expect(shopStateAfterFailure("error", "timeout", 7)).toEqual({
      status: "error",
      status_detail: "timeout",
      next_page: 7,
    });
    expect(shopStateAfterFailure("currency_not_mad", "", 1)).toEqual({
      status: "error",
      status_detail: "currency_not_mad",
      next_page: 1,
    });
  });
});
