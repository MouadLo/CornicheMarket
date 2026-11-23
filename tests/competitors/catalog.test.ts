import {
  discountPercent,
  imageFileName,
  nextOffset,
  readProgress,
  shopReason,
  slugify,
  sourcingCsvRows,
  sourcingShareText,
  validateNote,
  whatsappUrl,
} from "../../src/lib/competitors/catalog";

const item = (over = {}) => ({
  name: "Lorenz Crunchips Paprika",
  price_cents: 1500,
  regular_price_cents: 1800,
  shop_name: "Night",
  url: "https://night.ma/p/1",
  sourcing_note: "demander à Distrimar",
  sourcing_supplier_name: "Distrimar",
  sourcing_status: "to_ask" as const,
  ...over,
});

describe("discountPercent", () => {
  it("rounds to a whole percent with integers only", () => {
    expect(discountPercent(1200, 1500)).toBe(20);
    expect(discountPercent(1000, 1500)).toBe(33);
    expect(discountPercent(1499, 1500)).toBe(0);
  });
  it("is null without a promo", () => {
    expect(discountPercent(1500, 1500)).toBeNull();
    expect(discountPercent(1800, 1500)).toBeNull();
    expect(discountPercent(null, 1500)).toBeNull();
    expect(discountPercent(1000, null)).toBeNull();
    expect(discountPercent(1000, 0)).toBeNull();
  });
});

describe("file names", () => {
  it("slugifies a product name", () => {
    expect(slugify("Crème brûlée 100 g")).toBe("creme-brulee-100-g");
    expect(slugify("  Sidi Ali 1.5L!! ")).toBe("sidi-ali-1-5l");
    expect(slugify("عصير")).toBe("photo");
    expect(slugify("")).toBe("photo");
  });
  it("is bounded and never ends with a dash", () => {
    const slug = slugify("a".repeat(59) + " b c d e");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
  it("adds the extension", () => {
    expect(imageFileName("Sidi Ali 50cl", "webp")).toBe("sidi-ali-50cl.webp");
    expect(imageFileName("Sidi Ali", "../x")).toBe("sidi-ali.x");
    expect(imageFileName("Sidi Ali", "")).toBe("sidi-ali.jpg");
  });
});

describe("sourcing share text", () => {
  const labels = {
    heading: "Produits à sourcer :",
    theirPrice: (price: string) => `chez eux ${price}`,
    noPrice: "prix inconnu",
  };
  it("lists name, their price, supplier and note", () => {
    const text = sourcingShareText(
      [
        item(),
        item({
          name: "Sans prix",
          price_cents: null,
          sourcing_note: null,
          sourcing_supplier_name: null,
        }),
      ],
      labels
    );
    expect(text.split("\n")).toEqual([
      "Produits à sourcer :",
      "1. Lorenz Crunchips Paprika - chez eux 15.00 DH - Distrimar - demander à Distrimar",
      "2. Sans prix - prix inconnu",
    ]);
  });
  it("builds a wa.me link with the text encoded", () => {
    expect(whatsappUrl("a b\n1 & 2")).toBe("https://wa.me/?text=a%20b%0A1%20%26%202");
  });
});

describe("sourcing csv rows", () => {
  it("writes prices in DH with two decimals", () => {
    const rows = sourcingCsvRows(
      [
        item(),
        item({
          price_cents: null,
          regular_price_cents: null,
          sourcing_note: null,
          sourcing_supplier_name: null,
          sourcing_status: null,
        }),
      ],
      (s) => `S:${s}`
    );
    expect(rows[0]).toEqual([
      "Lorenz Crunchips Paprika",
      "15.00",
      "18.00",
      "Night",
      "Distrimar",
      "S:to_ask",
      "demander à Distrimar",
      "https://night.ma/p/1",
    ]);
    expect(rows[1]).toEqual([
      "Lorenz Crunchips Paprika",
      "",
      "",
      "Night",
      "",
      "",
      "",
      "https://night.ma/p/1",
    ]);
  });
});

describe("validateNote", () => {
  it("trims, nulls the empty note and refuses more than 300 characters", () => {
    expect(validateNote("  hello ")).toEqual({ ok: true, note: "hello" });
    expect(validateNote("   ")).toEqual({ ok: true, note: null });
    expect(validateNote("x".repeat(300)).ok).toBe(true);
    expect(validateNote("x".repeat(301))).toEqual({ ok: false });
  });
});

describe("shop reasons and state", () => {
  it("maps known reasons and falls back", () => {
    expect(shopReason("not_woocommerce")).toBe("competitors.shopReason.not_woocommerce");
    expect(shopReason("robots_disallow")).toBe("competitors.shopReason.robots_disallow");
    expect(shopReason("whatever")).toBe("competitors.shopReason.other");
    expect(shopReason(null)).toBe("competitors.shopReason.other");
  });
  it("progress", () => {
    expect(readProgress({ status: "syncing", next_page: 4, total_items: null })).toBe(4);
    expect(readProgress({ status: "ok", next_page: null, total_items: 10 })).toBeNull();
  });
  it("paging", () => {
    expect(nextOffset(30, 100)).toBe(30);
    expect(nextOffset(100, 100)).toBeNull();
  });
});
