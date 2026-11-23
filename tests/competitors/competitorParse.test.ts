import {
  classifyHttp,
  minorUnitsToCents,
  parseProductPage,
  parseShopifyJs,
  parseWooStore,
  planReaders,
  priceTextToCents,
  readingChanged,
  robotsAllows,
  shopifyJsUrl,
  wooStoreApiUrl,
  USER_AGENT,
} from "../../supabase/functions/_shared/competitorParse";

const okReading = (result: ReturnType<typeof parseWooStore>) => {
  if (!result.ok) throw new Error(`expected a reading, got ${result.detail}`);
  return result.reading;
};

describe("user agent", () => {
  it("identifies honestly", () => {
    expect(USER_AGENT).toBe("Mozilla/5.0 (compatible; CornicheMarket-price-check/1.0)");
  });
});

describe("robotsAllows", () => {
  it("allows everything with no robots rules or an empty Disallow", () => {
    expect(robotsAllows("", "/product/x/")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow:", "/product/x/")).toBe(true);
  });
  it("honours Disallow for *", () => {
    const txt = "User-agent: *\nDisallow: /wp-json/\nDisallow: /cart";
    expect(robotsAllows(txt, "/wp-json/wc/store/v1/products?slug=a")).toBe(false);
    expect(robotsAllows(txt, "/cart/")).toBe(false);
    expect(robotsAllows(txt, "/product/a/")).toBe(true);
  });
  it("blocks everything with Disallow: /", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /", "/product/a/")).toBe(false);
  });
  it("uses the group naming our agent instead of *", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: CornicheMarket-price-check\nAllow: /";
    expect(robotsAllows(txt, "/product/a/")).toBe(true);
    const blocked =
      "User-agent: *\nDisallow:\n\nUser-agent: cornichemarket-price-check\nDisallow: /product";
    expect(robotsAllows(blocked, "/product/a/")).toBe(false);
    expect(robotsAllows(blocked, "/other")).toBe(true);
  });
  it("lets the longest rule win and Allow win a tie", () => {
    const txt = "User-agent: *\nDisallow: /product\nAllow: /product/public";
    expect(robotsAllows(txt, "/product/public/x")).toBe(true);
    expect(robotsAllows(txt, "/product/private")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /a\nAllow: /a", "/a")).toBe(true);
  });
  it("supports * and $ wildcards", () => {
    const txt = "User-agent: *\nDisallow: /*?add-to-cart=\nDisallow: /*.pdf$";
    expect(robotsAllows(txt, "/p/?add-to-cart=3")).toBe(false);
    expect(robotsAllows(txt, "/a/file.pdf")).toBe(false);
    expect(robotsAllows(txt, "/a/file.pdf.html")).toBe(true);
  });
  it("ignores comments, shared agent lines and rules before any agent", () => {
    const txt =
      "# hi\nDisallow: /x\nUser-agent: bot-a\nUser-agent: *  # all\nDisallow: /secret # no\n";
    expect(robotsAllows(txt, "/x")).toBe(true);
    expect(robotsAllows(txt, "/secret")).toBe(false);
  });
  it("is case-insensitive on directives and handles CRLF and BOM", () => {
    expect(robotsAllows("﻿USER-AGENT: *\r\nDISALLOW: /no\r\n", "/no/a")).toBe(false);
  });
});

describe("planReaders", () => {
  it("sends Glovo and invalid or non-https links to manual", () => {
    expect(planReaders("https://glovoapp.com/ma/fr/casablanca/stores/x")).toEqual({
      manual: true,
      reason: "app_only_site",
    });
    expect(planReaders("https://www.glovoapp.com/x")).toMatchObject({ manual: true });
    expect(planReaders("http://shop.ma/product/x/")).toEqual({
      manual: true,
      reason: "invalid_url",
    });
    expect(planReaders("not a url")).toMatchObject({ manual: true });
  });
  it("tries WooCommerce then the page for /product/<slug>/", () => {
    const plan = planReaders("https://yournightshop.ma/product/crunchips-paprika-100g/");
    expect(plan).toEqual({
      manual: false,
      readers: [
        {
          kind: "woocommerce",
          url: "https://yournightshop.ma/wp-json/wc/store/v1/products?slug=crunchips-paprika-100g",
        },
        { kind: "page", url: "https://yournightshop.ma/product/crunchips-paprika-100g/" },
      ],
    });
  });
  it("tries Shopify .js then the page for /products/<handle>", () => {
    const plan = planReaders("https://mymarket.ma/products/cola-1l?variant=1");
    expect(plan).toMatchObject({ manual: false });
    if (plan.manual) return;
    expect(plan.readers.map((r) => r.kind)).toEqual(["shopify", "page"]);
    expect(plan.readers[0].url).toBe("https://mymarket.ma/products/cola-1l.js");
  });
  it("uses only the page for other paths", () => {
    const plan = planReaders("https://shop.ma/fr/p/12-cola");
    expect(plan).toEqual({
      manual: false,
      readers: [{ kind: "page", url: "https://shop.ma/fr/p/12-cola" }],
    });
  });
  it("derives the API urls", () => {
    expect(wooStoreApiUrl(new URL("https://s.ma/product/a-b/"))).toBe(
      "https://s.ma/wp-json/wc/store/v1/products?slug=a-b"
    );
    expect(wooStoreApiUrl(new URL("https://s.ma/shop/"))).toBeNull();
    expect(shopifyJsUrl(new URL("https://s.ma/fr/products/x.js"))).toBe(
      "https://s.ma/products/x.js"
    );
    expect(shopifyJsUrl(new URL("https://s.ma/product/x"))).toBeNull();
  });
});

describe("classifyHttp", () => {
  it("accepts 200", () => expect(classifyHttp(200, "<html>ok</html>")).toEqual({ kind: "ok" }));
  it.each([401, 403, 429, 451])("treats %i as a refusal", (status) => {
    expect(classifyHttp(status)).toEqual({ kind: "refused", detail: `http_${status}` });
  });
  it("treats a Cloudflare challenge as a refusal, even on 200 or 503", () => {
    const body = "<html><title>Just a moment...</title></html>";
    expect(classifyHttp(200, body)).toEqual({ kind: "refused", detail: "bot_challenge" });
    expect(classifyHttp(503, body)).toEqual({ kind: "refused", detail: "bot_challenge" });
  });
  it("does not mistake a product page that mentions captcha for a challenge", () => {
    const body = '<script type="application/ld+json">{"@type":"Product"}</script> g-recaptcha';
    expect(classifyHttp(200, body)).toEqual({ kind: "ok" });
  });
  it("treats 404 and 500 as plain errors", () => {
    expect(classifyHttp(404)).toEqual({ kind: "error", detail: "not_found" });
    expect(classifyHttp(500)).toEqual({ kind: "error", detail: "http_500" });
  });
});

describe("money conversion", () => {
  it.each([
    ["18.00", 1800],
    ["18", 1800],
    ["18,5", 1850],
    ["1 234.50", 123450],
    ["1.234,50", 123450],
    ["1,234.50", 123450],
    ["1,234", 123400],
    ["12.999", 1300],
    ["0.5", 50],
    ["19.90 DH", 1990],
    [18.5, 1850],
  ])("priceTextToCents(%p) = %p", (input, cents) => {
    expect(priceTextToCents(input)).toBe(cents);
  });
  it.each(["", "abc", "0", "0.00", null, undefined, {}])("rejects %p", (input) => {
    expect(priceTextToCents(input)).toBeNull();
  });
  it("converts any minor unit to centimes", () => {
    expect(minorUnitsToCents("1800", 2)).toBe(1800);
    expect(minorUnitsToCents("18", 0)).toBe(1800);
    expect(minorUnitsToCents("180", 1)).toBe(1800);
    expect(minorUnitsToCents("18000", 3)).toBe(1800);
    expect(minorUnitsToCents("18005", 3)).toBe(1801);
    expect(minorUnitsToCents("18004", 3)).toBe(1800);
    expect(minorUnitsToCents("1800", "2")).toBe(1800);
    expect(minorUnitsToCents("", 2)).toBeNull();
    expect(minorUnitsToCents("12.5", 2)).toBeNull();
    expect(minorUnitsToCents("0", 2)).toBeNull();
  });
});

describe("parseWooStore", () => {
  const verified = [
    {
      id: 1,
      name: "Lorenz Crunchips Paprika",
      slug: "crunchips-paprika-100g",
      is_in_stock: true,
      low_stock_remaining: null,
      prices: {
        price: "1800",
        regular_price: "1800",
        sale_price: "1800",
        currency_code: "MAD",
        currency_minor_unit: 2,
      },
      images: [{ src: "https://yournightshop.ma/wp-content/uploads/crunchips.jpg" }],
    },
  ];
  it("reads the verified real example", () => {
    expect(okReading(parseWooStore(verified, "crunchips-paprika-100g"))).toEqual({
      title: "Lorenz Crunchips Paprika",
      priceCents: 1800,
      regularPriceCents: 1800,
      onSale: false,
      inStock: true,
      lowStockRemaining: null,
      imageUrl: "https://yournightshop.ma/wp-content/uploads/crunchips.jpg",
    });
  });
  it("flags a promo and keeps the regular price", () => {
    const promo = [
      { ...verified[0], prices: { ...verified[0].prices, price: "1500", sale_price: "1500" } },
    ];
    const reading = okReading(parseWooStore(promo));
    expect(reading).toMatchObject({ priceCents: 1500, regularPriceCents: 1800, onSale: true });
  });
  it("reads low stock and out of stock", () => {
    const low = [{ ...verified[0], low_stock_remaining: 3 }];
    expect(okReading(parseWooStore(low)).lowStockRemaining).toBe(3);
    const out = [{ ...verified[0], is_in_stock: false }];
    expect(okReading(parseWooStore(out)).inStock).toBe(false);
  });
  it("converts other minor units", () => {
    const three = [
      {
        ...verified[0],
        prices: {
          ...verified[0].prices,
          price: "18000",
          regular_price: "18000",
          currency_minor_unit: 3,
        },
      },
    ];
    expect(okReading(parseWooStore(three)).priceCents).toBe(1800);
  });
  it("only accepts MAD", () => {
    const eur = [{ ...verified[0], prices: { ...verified[0].prices, currency_code: "EUR" } }];
    expect(parseWooStore(eur)).toEqual({
      ok: false,
      status: "unsupported",
      detail: "currency_not_mad",
    });
  });
  it("is unsupported for an empty list, a non-list or no price", () => {
    expect(parseWooStore([])).toMatchObject({ ok: false, status: "unsupported" });
    expect(parseWooStore({ code: "rest_no_route" })).toMatchObject({ ok: false });
    const none = [{ ...verified[0], prices: { currency_code: "MAD", currency_minor_unit: 2 } }];
    expect(parseWooStore(none)).toMatchObject({ ok: false, detail: "woocommerce_no_price" });
  });
  it("keeps an out-of-stock product without a price", () => {
    const none = [
      {
        ...verified[0],
        is_in_stock: false,
        prices: { currency_code: "MAD", currency_minor_unit: 2 },
      },
    ];
    expect(okReading(parseWooStore(none))).toMatchObject({ priceCents: null, inStock: false });
  });
  it("prefers the item whose slug matches", () => {
    const two = [{ ...verified[0], slug: "other", name: "Other" }, verified[0]];
    expect(okReading(parseWooStore(two, "crunchips-paprika-100g")).title).toBe(
      "Lorenz Crunchips Paprika"
    );
  });
});

describe("parseShopifyJs", () => {
  it("reads price, compare-at, availability and image", () => {
    const reading = okReading(
      parseShopifyJs({
        title: "Coca &amp; Cola 1L",
        price: 1200,
        compare_at_price: 1500,
        available: true,
        featured_image: "//cdn.shopify.com/s/files/cola.jpg",
      })
    );
    expect(reading).toEqual({
      title: "Coca & Cola 1L",
      priceCents: 1200,
      regularPriceCents: 1500,
      onSale: true,
      inStock: true,
      lowStockRemaining: null,
      imageUrl: "https://cdn.shopify.com/s/files/cola.jpg",
    });
  });
  it("reads out of stock and ignores a compare-at below the price", () => {
    const reading = okReading(
      parseShopifyJs({ title: "X", price: 1000, compare_at_price: 900, available: false })
    );
    expect(reading).toMatchObject({ inStock: false, onSale: false, regularPriceCents: 1000 });
  });
  it("is unsupported on other shapes", () => {
    expect(parseShopifyJs([])).toMatchObject({ ok: false });
    expect(parseShopifyJs({ title: "x" })).toMatchObject({ ok: false });
  });
});

const ld = (data: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

describe("parseProductPage JSON-LD", () => {
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Chips Paprika 100g",
    image: "https://shop.ma/img/chips.jpg",
    offers: {
      "@type": "Offer",
      price: "18.00",
      priceCurrency: "MAD",
      availability: "https://schema.org/InStock",
    },
  };
  it("reads a plain Product with an offer object", () => {
    expect(okReading(parseProductPage(ld(product)))).toEqual({
      title: "Chips Paprika 100g",
      priceCents: 1800,
      regularPriceCents: 1800,
      onSale: false,
      inStock: true,
      lowStockRemaining: null,
      imageUrl: "https://shop.ma/img/chips.jpg",
    });
  });
  it("finds the Product inside @graph", () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebSite", name: "Shop" }, product],
    };
    expect(okReading(parseProductPage(ld(graph))).priceCents).toBe(1800);
  });
  it("handles an array of blocks and @type arrays", () => {
    const html = ld([{ "@type": "BreadcrumbList" }, { ...product, "@type": ["Product", "Thing"] }]);
    expect(okReading(parseProductPage(html)).title).toBe("Chips Paprika 100g");
  });
  it("handles several script blocks and skips a broken one", () => {
    const html = `<script type="application/ld+json">{broken</script>${ld(product)}`;
    expect(okReading(parseProductPage(html)).priceCents).toBe(1800);
  });
  it("takes the cheapest in-stock offer of an offers array", () => {
    const html = ld({
      ...product,
      offers: [
        { price: "10.00", priceCurrency: "MAD", availability: "OutOfStock" },
        { price: "20.00", priceCurrency: "MAD", availability: "InStock" },
        { price: "18.50", priceCurrency: "MAD", availability: "http://schema.org/InStock" },
      ],
    });
    expect(okReading(parseProductPage(html))).toMatchObject({ priceCents: 1850, inStock: true });
  });
  it("is out of stock when every offer is", () => {
    const html = ld({
      ...product,
      offers: { ...product.offers, availability: "https://schema.org/OutOfStock" },
    });
    expect(okReading(parseProductPage(html))).toMatchObject({ priceCents: 1800, inStock: false });
  });
  it("accepts a numeric price, an AggregateOffer and an image object or array", () => {
    expect(
      okReading(
        parseProductPage(
          ld({
            ...product,
            offers: { price: 18.5, priceCurrency: "MAD" },
            image: { url: "https://a.ma/i.png" },
          })
        )
      )
    ).toMatchObject({ priceCents: 1850, imageUrl: "https://a.ma/i.png" });
    expect(
      okReading(
        parseProductPage(
          ld({
            ...product,
            offers: { "@type": "AggregateOffer", lowPrice: "9.90", priceCurrency: "MAD" },
            image: ["https://a.ma/1.png", "https://a.ma/2.png"],
          })
        )
      )
    ).toMatchObject({ priceCents: 990, imageUrl: "https://a.ma/1.png" });
  });
  it("reads a list price from priceSpecification as the regular price", () => {
    const html = ld({
      ...product,
      offers: {
        priceCurrency: "MAD",
        price: "15.00",
        priceSpecification: [
          { price: "15.00", priceCurrency: "MAD" },
          { price: "18.00", priceCurrency: "MAD", priceType: "https://schema.org/ListPrice" },
        ],
      },
    });
    expect(okReading(parseProductPage(html))).toMatchObject({
      priceCents: 1500,
      regularPriceCents: 1800,
      onSale: true,
    });
  });
  it("assumes in stock when availability is missing", () => {
    expect(
      okReading(parseProductPage(ld({ ...product, offers: { price: "5", priceCurrency: "MAD" } })))
        .inStock
    ).toBe(true);
  });
  it("refuses another currency or a missing one", () => {
    const eur = ld({ ...product, offers: { price: "5.00", priceCurrency: "EUR" } });
    expect(parseProductPage(eur)).toEqual({
      ok: false,
      status: "unsupported",
      detail: "currency_not_mad",
    });
    const none = ld({ ...product, offers: { price: "5.00" } });
    expect(parseProductPage(none)).toMatchObject({ ok: false, detail: "currency_not_mad" });
  });
  it("is unsupported without a Product", () => {
    expect(parseProductPage("<html><body>hello</body></html>")).toEqual({
      ok: false,
      status: "unsupported",
      detail: "no_product_data",
    });
  });
  it("decodes entities in the title and resolves relative images", () => {
    const html = ld({ ...product, name: "Lait &amp; Miel &#039;Bio&#039;", image: "/img/a.jpg" });
    const reading = okReading(parseProductPage(html, "https://shop.ma/p/1"));
    expect(reading.title).toBe("Lait & Miel 'Bio'");
    expect(reading.imageUrl).toBe("https://shop.ma/img/a.jpg");
  });
  it("drops non-http images", () => {
    expect(
      okReading(parseProductPage(ld({ ...product, image: "javascript:alert(1)" }))).imageUrl
    ).toBeNull();
  });
});

describe("parseProductPage OpenGraph fallback", () => {
  const html = `<html><head>
    <meta property="og:title" content="Eau Sidi Ali 1.5L">
    <meta content="https://shop.ma/eau.jpg" property="og:image">
    <meta property="product:price:amount" content="6,00">
    <meta property="product:price:currency" content="MAD">
    <meta property="product:availability" content="out of stock">
  </head></html>`;
  it("reads title, image, price and currency", () => {
    expect(okReading(parseProductPage(html))).toMatchObject({
      title: "Eau Sidi Ali 1.5L",
      priceCents: 600,
      imageUrl: "https://shop.ma/eau.jpg",
      inStock: true,
    });
  });
  it("reads availability when present", () => {
    const out = html
      .replace("out of stock", "oos")
      .replace("product:availability", "product:availability");
    expect(okReading(parseProductPage(out)).inStock).toBe(true);
    const sold = html.replace("out of stock", "OutOfStock");
    expect(okReading(parseProductPage(sold)).inStock).toBe(false);
  });
  it("needs MAD", () => {
    expect(parseProductPage(html.replace('content="MAD"', 'content="EUR"'))).toMatchObject({
      ok: false,
      detail: "currency_not_mad",
    });
  });
});

describe("readingChanged", () => {
  const reading = {
    title: "x",
    priceCents: 1800,
    regularPriceCents: 1800,
    onSale: false,
    inStock: true,
    lowStockRemaining: null,
    imageUrl: null,
  };
  const stored = { price_cents: 1800, regular_price_cents: 1800, in_stock: true };
  it("is true for a first reading", () => expect(readingChanged(null, reading)).toBe(true));
  it("is false when nothing changed", () => expect(readingChanged(stored, reading)).toBe(false));
  it("is true when price, regular price or stock changed", () => {
    expect(readingChanged(stored, { ...reading, priceCents: 1700 })).toBe(true);
    expect(readingChanged(stored, { ...reading, regularPriceCents: 2000 })).toBe(true);
    expect(readingChanged(stored, { ...reading, inStock: false })).toBe(true);
  });
});
