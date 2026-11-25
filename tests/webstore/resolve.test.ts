import {
  dropsBelowMinimum,
  excludedReason,
  feedStatus,
  linkSuggestions,
  MIN_FEED_PRODUCTS,
  nextWebId,
  priceConflict,
  resolvedInStock,
  resolvedPriceCents,
} from "../../src/lib/webstore/resolve";
import type { LinkCandidate, WebProduct } from "../../src/lib/webstore/types";

const app = (over: Partial<LinkCandidate> = {}): LinkCandidate => ({
  id: "a1",
  name: "Coca Cola 33cl",
  selling_price_cents: 600,
  stock_quantity: 5,
  active: true,
  kind: "regular",
  ...over,
});

const web = (over: Partial<WebProduct> = {}): WebProduct => ({
  id: "p001",
  product_id: null,
  name: "Coca Cola",
  name_fr: "Coca Cola",
  size: "33cl",
  category_id: "drinks",
  sub_code: null,
  popular: false,
  keywords: null,
  image_url: null,
  price_cents: 550,
  stock_mode: "manual",
  manual_in_stock: true,
  published: true,
  sort: 0,
  app: null,
  ...over,
});

const linked = (appOver: Partial<LinkCandidate> = {}, over: Partial<WebProduct> = {}) => {
  const a = app(appOver);
  return web({ product_id: a.id, app: a, ...over });
};

describe("resolvedPriceCents", () => {
  it("not linked: the typed price", () => {
    expect(resolvedPriceCents(web({ price_cents: 550 }))).toBe(550);
  });
  it("not linked, no price: null (prix à confirmer)", () => {
    expect(resolvedPriceCents(web({ price_cents: null }))).toBeNull();
  });
  it("a typed price of 0 is a price, not missing", () => {
    expect(resolvedPriceCents(web({ price_cents: 0 }))).toBe(0);
  });
  it("linked: the app price, whatever the typed one says", () => {
    expect(resolvedPriceCents(linked({ selling_price_cents: 725 }, { price_cents: 100 }))).toBe(
      725
    );
  });
  it("linked with no typed price still uses the app price", () => {
    expect(resolvedPriceCents(linked({ selling_price_cents: 725 }, { price_cents: null }))).toBe(
      725
    );
  });
  it("linked but the app row could not be read: null", () => {
    expect(resolvedPriceCents(web({ product_id: "gone", app: null }))).toBeNull();
  });
  it("keeps centimes exact (no float)", () => {
    expect(resolvedPriceCents(web({ price_cents: 1999 }))).toBe(1999);
  });
});

describe("resolvedInStock", () => {
  it("manual follows the switch", () => {
    expect(resolvedInStock(web({ manual_in_stock: true }))).toBe(true);
    expect(resolvedInStock(web({ manual_in_stock: false }))).toBe(false);
  });
  it("manual ignores the app stock even when linked", () => {
    expect(resolvedInStock(linked({ stock_quantity: 0 }, { manual_in_stock: true }))).toBe(true);
  });
  it("auto: in stock when the app has some", () => {
    expect(resolvedInStock(linked({ stock_quantity: 3 }, { stock_mode: "auto" }))).toBe(true);
  });
  it("auto: a weighed product with 0.5 kg left is in stock", () => {
    expect(resolvedInStock(linked({ stock_quantity: 0.5 }, { stock_mode: "auto" }))).toBe(true);
  });
  it("auto: zero or negative stock is out of stock", () => {
    expect(resolvedInStock(linked({ stock_quantity: 0 }, { stock_mode: "auto" }))).toBe(false);
    expect(resolvedInStock(linked({ stock_quantity: -2 }, { stock_mode: "auto" }))).toBe(false);
  });
  it("auto without a readable app product is out of stock", () => {
    expect(resolvedInStock(web({ stock_mode: "auto", product_id: "gone", app: null }))).toBe(false);
  });
});

describe("excludedReason", () => {
  it("an unlinked row is never excluded", () => {
    expect(excludedReason(web())).toBeNull();
  });
  it("linked to an active regular product: kept", () => {
    expect(excludedReason(linked())).toBeNull();
  });
  it("linked to an inactive product: excluded", () => {
    expect(excludedReason(linked({ active: false }))).toBe("inactive");
  });
  it("linked to the misc product: excluded", () => {
    expect(excludedReason(linked({ kind: "misc" }))).toBe("misc");
  });
  it("linked to a product that cannot be read: excluded", () => {
    expect(excludedReason(web({ product_id: "gone" }))).toBe("missing");
  });
});

describe("feedStatus", () => {
  const many = (n: number, over: Partial<WebProduct> = {}) =>
    Array.from({ length: n }, (_, i) => web({ id: `p${String(i + 1).padStart(3, "0")}`, ...over }));

  it("MIN is 20", () => {
    expect(MIN_FEED_PRODUCTS).toBe(20);
    expect(feedStatus([]).min).toBe(20);
  });
  it("empty list: nothing, below the minimum", () => {
    expect(feedStatus([])).toMatchObject({ published: 0, inFeed: 0, belowMinimum: true });
  });
  it("19 published is below, 20 is not", () => {
    expect(feedStatus(many(19)).belowMinimum).toBe(true);
    expect(feedStatus(many(20)).belowMinimum).toBe(false);
  });
  it("hidden products are not in the feed", () => {
    const s = feedStatus([...many(20), web({ id: "p900", published: false })]);
    expect(s).toMatchObject({ published: 20, inFeed: 20 });
  });
  it("published but excluded does not count towards the 20", () => {
    const list = [...many(19), linked({ active: false }, { id: "p800" })];
    const s = feedStatus(list);
    expect(s.published).toBe(20);
    expect(s.inFeed).toBe(19);
    expect(s.belowMinimum).toBe(true);
    expect(s.excluded.map((p) => p.id)).toEqual(["p800"]);
  });
  it("counts the in-stock ones among those in the feed only", () => {
    const list = [
      web({ id: "p001", manual_in_stock: true }),
      web({ id: "p002", manual_in_stock: false }),
      linked({ active: false }, { id: "p003", manual_in_stock: true }),
    ];
    expect(feedStatus(list).inFeedInStock).toBe(1);
  });
  it("a hidden excluded row is not reported as excluded", () => {
    expect(feedStatus([linked({ active: false }, { published: false })]).excluded).toEqual([]);
  });
});

describe("dropsBelowMinimum", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => web({ id: `p${100 + i}` }));
  it("hiding the 20th product drops below", () => {
    expect(dropsBelowMinimum(twenty, "p100", false)).toBe(true);
  });
  it("hiding one of 21 does not", () => {
    expect(dropsBelowMinimum([...twenty, web({ id: "p999" })], "p100", false)).toBe(false);
  });
  it("already below: no extra confirmation", () => {
    expect(dropsBelowMinimum(twenty.slice(0, 10), "p100", false)).toBe(false);
  });
  it("publishing never drops", () => {
    expect(dropsBelowMinimum(twenty, "p100", true)).toBe(false);
  });
  it("hiding a row that was excluded anyway changes nothing", () => {
    const list = [...twenty, linked({ active: false }, { id: "p500" })];
    expect(dropsBelowMinimum(list, "p500", false)).toBe(false);
  });
});

describe("nextWebId", () => {
  it("starts at p001", () => {
    expect(nextWebId([])).toBe("p001");
  });
  it("max + 1, padded to three digits", () => {
    expect(nextWebId(["p001", "p002", "p009"])).toBe("p010");
  });
  it("uses the max, not the count (gaps are kept)", () => {
    expect(nextWebId(["p001", "p050"])).toBe("p051");
  });
  it("goes past three digits", () => {
    expect(nextWebId(["p999"])).toBe("p1000");
    expect(nextWebId(["p1000", "p0999"])).toBe("p1001");
  });
  it("ignores ids that do not match p###", () => {
    expect(nextWebId(["kit1", "p12", "P005", "px100", "p001a", "abc"])).toBe("p001");
  });
  it("is stable on unordered input", () => {
    expect(nextWebId(["p010", "p002", "p007"])).toBe("p011");
  });
});

describe("priceConflict", () => {
  it("different prices: both reported", () => {
    expect(priceConflict(web({ price_cents: 550 }), app({ selling_price_cents: 600 }))).toEqual({
      siteCents: 550,
      appCents: 600,
    });
  });
  it("same price: none", () => {
    expect(priceConflict(web({ price_cents: 600 }), app({ selling_price_cents: 600 }))).toBeNull();
  });
  it("site price unknown: none", () => {
    expect(priceConflict(web({ price_cents: null }), app())).toBeNull();
  });
  it("no app product: none", () => {
    expect(priceConflict(web(), null)).toBeNull();
  });
  it("a typed 0 against a real price is a conflict", () => {
    expect(priceConflict(web({ price_cents: 0 }), app({ selling_price_cents: 600 }))).toEqual({
      siteCents: 0,
      appCents: 600,
    });
  });
  it("compares centimes, so 6.00 vs 6.01 differ", () => {
    expect(
      priceConflict(web({ price_cents: 600 }), app({ selling_price_cents: 601 }))
    ).not.toBeNull();
  });
});

describe("linkSuggestions", () => {
  const catalog: LinkCandidate[] = [
    app({ id: "a1", name: "Coca Cola 33cl" }),
    app({ id: "a2", name: "Coca Cola 1.5L" }),
    app({ id: "a3", name: "Fanta Orange 33cl" }),
    app({ id: "a4", name: "Savon de Marseille" }),
    app({ id: "a5", name: "Coca Cola 33cl vieux", active: false }),
    app({ id: "a6", name: "Coca Cola 33cl", kind: "misc" }),
  ];

  it("proposes the matching product first, with its confidence", () => {
    const [first] = linkSuggestions(web(), catalog);
    expect(first.product.id).toBe("a1");
    expect(first.confidence).toBe("proposed");
  });
  it("a different size is never the top proposal", () => {
    const out = linkSuggestions(web(), catalog);
    expect(out.map((s) => s.product.id)).not.toContain("a2");
  });
  it("ignores inactive and misc products", () => {
    const ids = linkSuggestions(web(), catalog, 10).map((s) => s.product.id);
    expect(ids).not.toContain("a5");
    expect(ids).not.toContain("a6");
  });
  it("skips products already linked to another web product", () => {
    const ids = linkSuggestions(web(), catalog, 3, new Set(["a1"])).map((s) => s.product.id);
    expect(ids).not.toContain("a1");
  });
  it("returns at most n, best first", () => {
    const out = linkSuggestions(web({ size: null }), catalog, 2);
    expect(out.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < out.length; i++)
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });
  it("returns nothing for an unrelated product, and for n = 0", () => {
    expect(linkSuggestions(web({ name: "Tournevis", name_fr: null, size: null }), catalog)).toEqual(
      []
    );
    expect(linkSuggestions(web(), catalog, 0)).toEqual([]);
  });
  it("falls back to the English name when there is no French one", () => {
    const [first] = linkSuggestions(web({ name_fr: null, name: "Coca Cola" }), catalog);
    expect(first.product.id).toBe("a1");
  });
  it("an empty catalogue gives nothing", () => {
    expect(linkSuggestions(web(), [])).toEqual([]);
  });
});
