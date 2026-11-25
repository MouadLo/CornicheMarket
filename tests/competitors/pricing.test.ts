import {
  bpToPercentText,
  cheapestRelevant,
  decide,
  floorPriceCents,
  isFresh,
  marginBp,
  needsReview,
  percentToBp,
  STALE_AFTER_MS,
  type CompetitorOffer,
} from "../../src/lib/competitors/pricing";
import { compareProducts, type OverviewRow } from "../../src/lib/competitors/overview";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const offer = (over: Partial<CompetitorOffer> = {}): CompetitorOffer => ({
  linkId: "l1",
  shopName: "Shop",
  priceCents: 1000,
  regularPriceCents: 1000,
  onSale: false,
  inStock: true,
  checkedAt: hoursAgo(2),
  ...over,
});

const run = (over: Partial<Parameters<typeof decide>[0]> = {}) =>
  decide({
    sellingPriceCents: 1200,
    costCents: 800,
    minMarginBp: 1500,
    offers: [offer()],
    now: NOW,
    ...over,
  });

describe("margin helpers", () => {
  it("computes margin in basis points with integer math", () => {
    expect(marginBp(1000, 800)).toBe(2000);
    expect(marginBp(1200, 800)).toBe(3333);
    expect(marginBp(700, 800)).toBe(-1429);
    expect(marginBp(0, 0)).toBeNull();
  });
  it("converts percent to basis points and back", () => {
    expect(percentToBp(15)).toBe(1500);
    expect(percentToBp("5.00")).toBe(500);
    expect(percentToBp("12.5")).toBe(1250);
    expect(bpToPercentText(1500)).toBe("15");
    expect(bpToPercentText(1250)).toBe("12.5");
    expect(bpToPercentText(505)).toBe("5.05");
  });
  it("rounds the floor price up to the next 0.50 DH, never below the floor", () => {
    // 8.00 / 0.85 = 9.4117... -> 9.42 -> 9.50
    expect(floorPriceCents(800, 1500)).toBe(950);
    // exactly on a step stays: 8.50 / 0.85 = 10.00
    expect(floorPriceCents(850, 1500)).toBe(1000);
    // 5 % floor: 8.00 / 0.95 = 8.4210... -> 8.50
    expect(floorPriceCents(800, 500)).toBe(850);
    // one centime over a step goes to the next one
    expect(floorPriceCents(851, 1500)).toBe(1050);
    for (const cost of [137, 800, 999, 1234]) {
      for (const bp of [0, 500, 1500, 3000]) {
        const price = floorPriceCents(cost, bp);
        expect(price % 50).toBe(0);
        expect((marginBp(price, cost) as number) >= bp).toBe(true);
        expect((price - cost) * 10000 >= bp * price).toBe(true);
      }
    }
  });
});

describe("freshness and relevance", () => {
  it("is fresh for 7 days, stale after", () => {
    expect(isFresh(hoursAgo(24 * 7 - 1), NOW)).toBe(true);
    expect(isFresh(new Date(NOW - STALE_AFTER_MS).toISOString(), NOW)).toBe(true);
    expect(isFresh(hoursAgo(24 * 7 + 1), NOW)).toBe(false);
    expect(isFresh(null, NOW)).toBe(false);
    expect(isFresh("garbage", NOW)).toBe(false);
  });
  it("ignores out-of-stock, stale, never-checked and price-less offers", () => {
    const offers = [
      offer({ linkId: "a", priceCents: 500, inStock: false }),
      offer({ linkId: "b", priceCents: 600, checkedAt: hoursAgo(24 * 8) }),
      offer({ linkId: "c", priceCents: 700, checkedAt: null }),
      offer({ linkId: "d", priceCents: null }),
      offer({ linkId: "e", priceCents: 900 }),
    ];
    expect(cheapestRelevant(offers, NOW)?.linkId).toBe("e");
  });
  it("takes the cheapest, and the freshest on a tie", () => {
    const offers = [
      offer({ linkId: "a", priceCents: 900, checkedAt: hoursAgo(10) }),
      offer({ linkId: "b", priceCents: 800, checkedAt: hoursAgo(5) }),
      offer({ linkId: "c", priceCents: 800, checkedAt: hoursAgo(1) }),
    ];
    expect(cheapestRelevant(offers, NOW)?.linkId).toBe("c");
  });
});

describe("decide", () => {
  it("no_data without a usable competitor price, even when others are ignored", () => {
    expect(run({ offers: [] }).outcome).toBe("no_data");
    const ignored = run({
      offers: [offer({ inStock: false }), offer({ checkedAt: hoursAgo(24 * 9) })],
    });
    expect(ignored).toMatchObject({ outcome: "no_data", suggestedCents: null, offer: null });
  });

  it("no_cost: only the gap, no suggestion", () => {
    for (const costCents of [null, 0]) {
      const d = run({ costCents });
      expect(d).toMatchObject({
        outcome: "no_cost",
        suggestedCents: null,
        gapCents: 200,
        currentMarginBp: null,
        marginIfMatchedBp: null,
      });
    }
  });

  it("ok when we are cheaper or equal (within 10 %)", () => {
    const equal = run({ sellingPriceCents: 1000 });
    expect(equal).toMatchObject({ outcome: "ok", suggestedCents: null, gapCents: 0 });
    const cheaper = run({ sellingPriceCents: 950 });
    expect(cheaper).toMatchObject({ outcome: "ok", gapCents: -50 });
  });

  it("could_raise when we are cheaper by more than 10 %: competitor minus 0.50 DH", () => {
    const d = run({
      sellingPriceCents: 800,
      costCents: 500,
      offers: [offer({ priceCents: 1000 })],
    });
    expect(d).toMatchObject({ outcome: "could_raise", suggestedCents: 950, gapCents: -200 });
    expect(needsReview(d)).toBe(true);
  });
  it("exactly 10 % cheaper is not enough; just over is", () => {
    const exactly = run({
      sellingPriceCents: 900,
      costCents: 500,
      offers: [offer({ priceCents: 1000 })],
    });
    expect(exactly.outcome).toBe("ok");
    const over = run({
      sellingPriceCents: 899,
      costCents: 500,
      offers: [offer({ priceCents: 1000 })],
    });
    expect(over).toMatchObject({ outcome: "could_raise", suggestedCents: 950 });
  });
  it("could_raise never goes below our current price", () => {
    // 10.4 vs competitor 11.6: >10 % cheaper but competitor - 0.50 = 11.10 > ours; fine.
    // Competitor 11.00, ours 9.80: 12 % cheaper, raise to 10.50.
    expect(
      run({ sellingPriceCents: 980, costCents: 500, offers: [offer({ priceCents: 1100 })] })
        .suggestedCents
    ).toBe(1050);
    // Tiny prices: competitor 60, ours 40 (33 % cheaper), 60-50 = 10 < ours -> no raise.
    const tiny = run({ sellingPriceCents: 40, costCents: 20, offers: [offer({ priceCents: 60 })] });
    expect(tiny).toMatchObject({ outcome: "ok", suggestedCents: null });
  });

  it("lower: matching keeps the floor, suggest the competitor price exactly", () => {
    // cost 8.00, competitor 10.00 -> 20 % margin >= 15 %
    const d = run();
    expect(d).toMatchObject({
      outcome: "lower",
      suggestedCents: 1000,
      currentMarginBp: 3333,
      marginIfMatchedBp: 2000,
      gapCents: 200,
      promo: false,
    });
    expect(d.offer?.linkId).toBe("l1");
    expect(needsReview(d)).toBe(true);
  });
  it("lower exactly at the floor", () => {
    // cost 8.50, competitor 10.00 -> exactly 15 %
    expect(run({ costCents: 850 }).outcome).toBe("lower");
    // cost 8.51 -> below 15 %
    expect(run({ costCents: 851 }).outcome).toBe("floor");
  });

  it("floor: matching would break the floor, suggest the floor price rounded up to 0.50", () => {
    // cost 8.00, competitor 9.00 -> 11.1 % < 15 %; floor 8/0.85 = 9.41 -> 9.50 < 12.00
    const d = run({ offers: [offer({ priceCents: 900 })] });
    expect(d).toMatchObject({ outcome: "floor", suggestedCents: 950, marginIfMatchedBp: 1111 });
    expect(needsReview(d)).toBe(true);
  });
  it("floor with a 5 % per-product override", () => {
    // Same product: with a 5 % floor, matching 9.00 (11.1 %) is fine.
    const d = run({ minMarginBp: 500, offers: [offer({ priceCents: 900 })] });
    expect(d).toMatchObject({ outcome: "lower", suggestedCents: 900 });
    // 5 % floor, competitor 8.20 (2.4 % margin): floor price 8.00/0.95 = 8.42 -> 8.50
    const f = run({ minMarginBp: 500, offers: [offer({ priceCents: 820 })] });
    expect(f).toMatchObject({ outcome: "floor", suggestedCents: 850 });
  });
  it("floor with no suggestion when the floor price is not below our price", () => {
    // ours 9.50 = floor price already, competitor 9.00
    const d = run({ sellingPriceCents: 950, offers: [offer({ priceCents: 900 })] });
    expect(d).toMatchObject({ outcome: "floor", suggestedCents: null });
    expect(needsReview(d)).toBe(false);
    // ours 9.20, floor price 9.50 would raise it: no suggestion
    expect(
      run({ sellingPriceCents: 920, offers: [offer({ priceCents: 900 })] }).suggestedCents
    ).toBeNull();
  });

  it("dont_follow when the competitor is below our unit cost", () => {
    const d = run({ offers: [offer({ priceCents: 700 })] });
    expect(d).toMatchObject({
      outcome: "dont_follow",
      suggestedCents: null,
      marginIfMatchedBp: -1429,
      gapCents: 500,
    });
    expect(needsReview(d)).toBe(false);
  });
  it("a competitor price equal to cost is a floor case, not dont_follow", () => {
    const d = run({ offers: [offer({ priceCents: 800 })] });
    expect(d.outcome).toBe("floor");
    expect(d.suggestedCents).toBe(950);
  });

  it("uses the cheapest relevant offer and ignores out-of-stock and stale ones", () => {
    const d = run({
      offers: [
        offer({ linkId: "oos", priceCents: 700, inStock: false }),
        offer({ linkId: "stale", priceCents: 750, checkedAt: hoursAgo(24 * 10) }),
        offer({ linkId: "a", shopName: "A", priceCents: 1100 }),
        offer({ linkId: "b", shopName: "B", priceCents: 1000 }),
      ],
    });
    expect(d.offer?.linkId).toBe("b");
    expect(d.outcome).toBe("lower");
    expect(d.suggestedCents).toBe(1000);
  });
  it("reports whether the competitor price is a promo", () => {
    const d = run({ offers: [offer({ priceCents: 1000, regularPriceCents: 1300, onSale: true })] });
    expect(d.promo).toBe(true);
    expect(d.outcome).toBe("lower");
  });
  it("works for per-kg products as stored (prices are per unit)", () => {
    const d = run({
      sellingPriceCents: 4500,
      costCents: 3000,
      offers: [offer({ priceCents: 4000 })],
    });
    expect(d).toMatchObject({ outcome: "lower", suggestedCents: 4000, marginIfMatchedBp: 2500 });
  });
  it("a zero selling price gives no margin and does not throw", () => {
    const d = run({ sellingPriceCents: 0 });
    expect(d.currentMarginBp).toBeNull();
  });
});

describe("compareProducts", () => {
  const row = (over: Partial<OverviewRow>): OverviewRow => ({
    product_id: "p1",
    product_name: "Chips",
    unit: "piece",
    selling_price_cents: 1200,
    cost_cents: 800,
    min_margin_percent: "15.00",
    margin_override: null,
    link_id: "l1",
    shop_name: "Shop A",
    url: "https://a.ma/x",
    mode: "auto",
    last_status: "ok",
    last_status_detail: null,
    last_checked_at: hoursAgo(1),
    last_ok_at: hoursAgo(1),
    price_cents: 1000,
    regular_price_cents: 1000,
    on_sale: false,
    in_stock: true,
    low_stock_remaining: null,
    title: "Chips",
    image_url: null,
    observed_at: hoursAgo(1),
    price_check: false,
    sold_30d: 0,
    ...over,
  });
  it("groups links by product and decides per product with the effective floor", () => {
    const rows = [
      row({}),
      row({ link_id: "l2", shop_name: "Shop B", price_cents: 900, regular_price_cents: 900 }),
      row({
        product_id: "p2",
        product_name: "Eau",
        min_margin_percent: 5,
        cost_cents: null,
        link_id: "l3",
      }),
    ];
    const result = compareProducts(rows, NOW);
    expect(result.map((r) => r.productId)).toEqual(["p1", "p2"]);
    expect(result[0].offers).toHaveLength(2);
    expect(result[0].minMarginBp).toBe(1500);
    expect(result[0].decision.outcome).toBe("floor");
    expect(result[0].decision.suggestedCents).toBe(950);
    expect(result[1].decision.outcome).toBe("no_cost");
    expect(result[1].minMarginBp).toBe(500);
  });
  it("treats a link never read as unusable and flags out-of-stock links", () => {
    const rows = [
      row({ price_cents: null, in_stock: null, last_ok_at: null }),
      row({ link_id: "l2", in_stock: false }),
    ];
    const [product] = compareProducts(rows, NOW);
    expect(product.decision.outcome).toBe("no_data");
    expect(product.anyOutOfStock).toBe(true);
  });
});
