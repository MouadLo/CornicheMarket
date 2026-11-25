import { compareProducts, type OverviewRow } from "../../src/lib/competitors/overview";
import {
  moneyOnTheTable,
  priceCheckAlerts,
  suggestPriceCheck,
} from "../../src/lib/competitors/opportunities";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const row = (over: Partial<OverviewRow>): OverviewRow => ({
  product_id: "p1",
  product_name: "Chips",
  unit: "piece",
  selling_price_cents: 1200,
  cost_cents: 800,
  min_margin_percent: 15,
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

const compare = (rows: OverviewRow[]) => compareProducts(rows, Date.now());

describe("compareProducts: new fields", () => {
  it("carries price_check and sold_30d (numeric arrives as a string)", () => {
    const [p] = compare([row({ price_check: true, sold_30d: "12.5" })]);
    expect(p.priceCheck).toBe(true);
    expect(p.sold30d).toBe(12.5);
  });
  it("defaults to untagged and 0 sold when the columns are missing", () => {
    const bare = { ...row({}) } as Partial<OverviewRow>;
    delete bare.price_check;
    delete bare.sold_30d;
    const [p] = compare([bare as OverviewRow]);
    expect(p.priceCheck).toBe(false);
    expect(p.sold30d).toBe(0);
  });
});

describe("priceCheckAlerts", () => {
  it("lists tagged products where we are dearer, with gap and a lower/floor action", () => {
    const alerts = priceCheckAlerts(compare([row({ price_check: true })]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].gapCents).toBe(200);
    // 2.00 DH on their 10.00 DH = 20 %
    expect(alerts[0].gapBp).toBe(2000);
    expect(alerts[0].action).toBe("apply");
    expect(alerts[0].suggestedCents).toBe(1000);
  });

  it("suggests the floor price when matching would break the margin floor", () => {
    // cost 9.00, their price 9.50 -> margin 5 % < 15 %: floor = 9.00/0.85 = 10.59 -> 11.00
    const alerts = priceCheckAlerts(
      compare([row({ price_check: true, cost_cents: 900, price_cents: 950 })])
    );
    expect(alerts[0].action).toBe("apply");
    expect(alerts[0].suggestedCents).toBe(1100);
  });

  it("flags 'below your cost' (nothing to apply) when their price is under our cost", () => {
    const alerts = priceCheckAlerts(compare([row({ price_check: true, price_cents: 700 })]));
    expect(alerts[0].action).toBe("below_cost");
    expect(alerts[0].suggestedCents).toBeNull();
  });

  it("has no suggestion when we are already at the floor", () => {
    // cost 9.00 -> floor 11.00; ours 11.00, theirs 10.50: dearer but at the floor
    const alerts = priceCheckAlerts(
      compare([
        row({ price_check: true, selling_price_cents: 1100, cost_cents: 900, price_cents: 1050 }),
      ])
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].action).toBe("none");
    expect(alerts[0].suggestedCents).toBeNull();
  });

  it("ignores untagged products", () => {
    expect(priceCheckAlerts(compare([row({ price_check: false })]))).toEqual([]);
  });

  it("ignores equal and cheaper prices", () => {
    const rows = [
      row({ price_check: true, selling_price_cents: 1000 }),
      row({ product_id: "p2", link_id: "l2", price_check: true, selling_price_cents: 900 }),
    ];
    expect(priceCheckAlerts(compare(rows))).toEqual([]);
  });

  it("ignores tagged products with no relevant offer (stale, out of stock, no price)", () => {
    const rows = [
      row({ price_check: true, last_ok_at: hoursAgo(24 * 8) }),
      row({ product_id: "p2", link_id: "l2", price_check: true, in_stock: false }),
      row({ product_id: "p3", link_id: "l3", price_check: true, price_cents: null }),
    ];
    expect(priceCheckAlerts(compare(rows))).toEqual([]);
  });

  it("still alerts without a cost (no_cost), with nothing to apply", () => {
    const alerts = priceCheckAlerts(compare([row({ price_check: true, cost_cents: null })]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].action).toBe("none");
  });

  it("sorts by gap percent of their price, biggest first", () => {
    const rows = [
      // 1.00 on 10.00 = 10 %
      row({
        product_id: "a",
        product_name: "A",
        link_id: "la",
        price_check: true,
        selling_price_cents: 1100,
      }),
      // 3.00 on 10.00 = 30 %
      row({
        product_id: "b",
        product_name: "B",
        link_id: "lb",
        price_check: true,
        selling_price_cents: 1300,
      }),
      // 2.00 on 5.00 = 40 % although the gap in cents is smaller than the first two sum
      row({
        product_id: "c",
        product_name: "C",
        link_id: "lc",
        price_check: true,
        selling_price_cents: 700,
        cost_cents: 300,
        price_cents: 500,
      }),
    ];
    expect(priceCheckAlerts(compare(rows)).map((a) => a.comparison.name)).toEqual(["C", "B", "A"]);
  });

  it("uses the cheapest relevant offer of a product with several shops", () => {
    const rows = [
      row({ price_check: true }),
      row({ link_id: "l2", shop_name: "Shop B", price_check: true, price_cents: 1100 }),
    ];
    const alerts = priceCheckAlerts(compare(rows));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].gapCents).toBe(200);
  });
});

describe("suggestPriceCheck", () => {
  const rows = [
    row({ product_id: "a", product_name: "A", link_id: "la", sold_30d: 5 }),
    row({ product_id: "b", product_name: "B", link_id: "lb", sold_30d: 50 }),
    row({ product_id: "c", product_name: "C", link_id: "lc", sold_30d: 0 }),
    row({ product_id: "d", product_name: "D", link_id: "ld", sold_30d: 40, price_check: true }),
    row({ product_id: "e", product_name: "E", link_id: "le", sold_30d: 30, in_stock: false }),
    row({ product_id: "f", product_name: "F", link_id: "lf", sold_30d: 2.5, unit: "kg" }),
  ];
  it("keeps untagged products with an offer and sales, best sellers first", () => {
    expect(suggestPriceCheck(compare(rows)).map((c) => c.name)).toEqual(["B", "A", "F"]);
  });
  it("honours the limit", () => {
    expect(suggestPriceCheck(compare(rows), 2).map((c) => c.name)).toEqual(["B", "A"]);
    expect(suggestPriceCheck(compare(rows), 0)).toEqual([]);
  });
  it("defaults to ten", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      row({ product_id: `p${i}`, product_name: `P${i}`, link_id: `l${i}`, sold_30d: i + 1 })
    );
    expect(suggestPriceCheck(compare(many))).toHaveLength(10);
  });
});

describe("moneyOnTheTable", () => {
  // ours 8.00, theirs 10.00 -> target 9.50, +1.50 per unit
  const cheap = (over: Partial<OverviewRow>) =>
    row({ selling_price_cents: 800, cost_cents: 500, ...over });

  it("computes the target (their price - 0.50 DH) and the monthly gain", () => {
    const result = moneyOnTheTable(compare([cheap({ sold_30d: 20 })]));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      theirsCents: 1000,
      targetCents: 950,
      perUnitGainCents: 150,
      monthlyGainCents: 3000,
    });
    expect(result.totalMonthlyGainCents).toBe(3000);
    expect(result.noSalesCount).toBe(0);
  });

  it("handles decimal kg quantities with one rounding to the centime", () => {
    // 2.345 kg x 1.50 DH = 351.75 -> 352 centimes
    const result = moneyOnTheTable(compare([cheap({ unit: "kg", sold_30d: "2.345" })]));
    expect(result.items[0].monthlyGainCents).toBe(352);
    expect(Number.isInteger(result.items[0].monthlyGainCents)).toBe(true);
  });

  it("skips a gap below 0.50 DH (target not above our price)", () => {
    // ours 9.60, theirs 10.00 -> target 9.50 < ours
    const result = moneyOnTheTable(compare([cheap({ selling_price_cents: 960, sold_30d: 10 })]));
    expect(result.items).toEqual([]);
    expect(result.noSalesCount).toBe(0);
  });

  it("skips a target equal to our price", () => {
    const result = moneyOnTheTable(compare([cheap({ selling_price_cents: 950, sold_30d: 10 })]));
    expect(result.items).toEqual([]);
  });

  it("skips equal and dearer prices", () => {
    const rows = [
      cheap({ selling_price_cents: 1000, sold_30d: 10 }),
      cheap({ product_id: "p2", link_id: "l2", selling_price_cents: 1200, sold_30d: 10 }),
    ];
    expect(moneyOnTheTable(compare(rows)).items).toEqual([]);
  });

  it("skips products with no relevant offer", () => {
    const rows = [
      cheap({ sold_30d: 10, in_stock: false }),
      cheap({ product_id: "p2", link_id: "l2", sold_30d: 10, last_ok_at: hoursAgo(24 * 9) }),
    ];
    const result = moneyOnTheTable(compare(rows));
    expect(result.items).toEqual([]);
    expect(result.noSalesCount).toBe(0);
  });

  it("includes products without a cost", () => {
    const result = moneyOnTheTable(compare([cheap({ cost_cents: null, sold_30d: 4 })]));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].monthlyGainCents).toBe(600);
  });

  it("counts cheaper products with no sale instead of listing them", () => {
    const rows = [
      cheap({ sold_30d: 0 }),
      cheap({ product_id: "p2", link_id: "l2", sold_30d: 3 }),
      cheap({ product_id: "p3", link_id: "l3", sold_30d: 0 }),
    ];
    const result = moneyOnTheTable(compare(rows));
    expect(result.items.map((i) => i.comparison.productId)).toEqual(["p2"]);
    expect(result.noSalesCount).toBe(2);
    expect(result.totalMonthlyGainCents).toBe(450);
  });

  it("ranks by monthly gain, then sums the total", () => {
    const rows = [
      // 1.50 x 10 = 15.00
      cheap({ product_id: "a", product_name: "A", link_id: "la", sold_30d: 10 }),
      // 0.50 (ours 9.00) x 100 = 50.00
      cheap({
        product_id: "b",
        product_name: "B",
        link_id: "lb",
        selling_price_cents: 900,
        sold_30d: 100,
      }),
      // 1.50 x 30 = 45.00
      cheap({ product_id: "c", product_name: "C", link_id: "lc", sold_30d: 30 }),
    ];
    const result = moneyOnTheTable(compare(rows));
    expect(result.items.map((i) => i.comparison.name)).toEqual(["B", "C", "A"]);
    expect(result.totalMonthlyGainCents).toBe(1500 + 5000 + 4500);
  });

  it("is empty for an empty list", () => {
    expect(moneyOnTheTable([])).toEqual({ items: [], totalMonthlyGainCents: 0, noSalesCount: 0 });
  });
});
