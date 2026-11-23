import {
  freshness,
  manualPointChanged,
  reasonKey,
  validateLinkInput,
} from "../../src/lib/competitors/link";

describe("validateLinkInput", () => {
  it("accepts a name and an https link, trimming both", () => {
    expect(validateLinkInput("  Shop ", " https://a.ma/product/x/ ")).toEqual({
      ok: true,
      shopName: "Shop",
      url: "https://a.ma/product/x/",
    });
  });
  it("rejects empty or too long names", () => {
    expect(validateLinkInput("", "https://a.ma/x")).toEqual({ ok: false, field: "shopName" });
    expect(validateLinkInput("x".repeat(61), "https://a.ma/x")).toEqual({
      ok: false,
      field: "shopName",
    });
    expect(validateLinkInput("x".repeat(60), "https://a.ma/x").ok).toBe(true);
  });
  it("rejects http, other schemes, junk, spaces and long links", () => {
    for (const url of [
      "http://a.ma/x",
      "javascript:alert(1)",
      "ftp://a.ma",
      "a.ma/x",
      "https://nodot",
      "https://a.ma/a b",
      `https://a.ma/${"x".repeat(2000)}`,
    ]) {
      expect(validateLinkInput("Shop", url)).toEqual({ ok: false, field: "url" });
    }
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("uses the coarsest unit and never says 0 minutes", () => {
    expect(freshness(ago(10_000), now)).toEqual({ unit: "minutes", count: 1 });
    expect(freshness(ago(5 * 60_000), now)).toEqual({ unit: "minutes", count: 5 });
    expect(freshness(ago(2 * 3600_000), now)).toEqual({ unit: "hours", count: 2 });
    expect(freshness(ago(47 * 3600_000), now)).toEqual({ unit: "hours", count: 47 });
    expect(freshness(ago(72 * 3600_000), now)).toEqual({ unit: "days", count: 3 });
  });
  it("is null without a usable date", () => {
    expect(freshness(null, now)).toBeNull();
    expect(freshness("nope", now)).toBeNull();
  });
});

describe("reasonKey", () => {
  it("maps known reasons and falls back for unknown ones", () => {
    expect(reasonKey("robots_disallow")).toBe("competitors.reason.robots_disallow");
    expect(reasonKey("http_429")).toBe("competitors.reason.http_429");
    expect(reasonKey("something_new")).toBe("competitors.reason.other");
    expect(reasonKey(null)).toBe("competitors.reason.other");
  });
});

describe("manualPointChanged", () => {
  const prev = { price_cents: 1000, regular_price_cents: 1000, in_stock: true };
  it("stores the first point and any change of price or stock only", () => {
    expect(manualPointChanged(null, { priceCents: 1000, inStock: true })).toBe(true);
    expect(manualPointChanged(prev, { priceCents: 1000, inStock: true })).toBe(false);
    expect(manualPointChanged(prev, { priceCents: 900, inStock: true })).toBe(true);
    expect(manualPointChanged(prev, { priceCents: 1000, inStock: false })).toBe(true);
    expect(manualPointChanged(prev, { priceCents: null, inStock: false })).toBe(true);
  });
});
