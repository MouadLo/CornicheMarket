import {
  countDiscrepancy,
  COVER_DAYS,
  dailySalesRate,
  daysNegative,
  daysOfStockLeft,
  lossValueCents,
  roundUpForUnit,
  stockAfterCount,
  suggestedReorder,
} from "../../src/lib/inventory/reorder";

describe("stock count", () => {
  it("finds nothing when the shelf matches the system", () => {
    expect(countDiscrepancy(45, 45)).toBe(0);
  });

  it("reports missing stock as a negative discrepancy", () => {
    expect(countDiscrepancy(42, 45)).toBe(-3);
  });

  it("reports found stock as positive", () => {
    expect(countDiscrepancy(47, 45)).toBe(2);
  });

  it("handles fractional kg counts", () => {
    expect(countDiscrepancy(2.25, 3)).toBe(-0.75);
  });

  // The important one: a sale rung up mid-count must not be undone.
  it("keeps a sale made during the count", () => {
    // Device showed 45, cashier counted 45, then 2 were sold (live is 43).
    // Applying the count must leave 43, not reset the shelf back to 45.
    expect(stockAfterCount(43, 45, 45)).toBe(43);
  });

  it("applies a real discrepancy on top of a concurrent sale", () => {
    // Device showed 45, only 42 were on the shelf, and 2 sold meanwhile.
    // Live 43 minus the 3 that were genuinely missing = 40.
    expect(stockAfterCount(43, 42, 45)).toBe(40);
  });

  it("sets stock to the counted figure when nothing else moved", () => {
    expect(stockAfterCount(45, 42, 45)).toBe(42);
  });
});

describe("dailySalesRate", () => {
  it("averages the 30 day window", () => {
    expect(dailySalesRate(60)).toBe(2);
  });

  it("is zero for something that never sold", () => {
    expect(dailySalesRate(0)).toBe(0);
  });
});

describe("suggestedReorder", () => {
  it("covers two weeks of demand plus the threshold, less current stock", () => {
    // 60 sold in 30 days = 2/day -> 28 for cover, +10 threshold = 38 target
    // 8 on the shelf -> order 30
    expect(suggestedReorder(60, 8, 10, "piece")).toBe(30);
  });

  it("suggests nothing when stock already covers the target", () => {
    expect(suggestedReorder(60, 100, 10, "piece")).toBe(0);
  });

  it("only tops a non-selling product back to its threshold", () => {
    // Nothing sold: do not buy two weeks of demand for a dead product.
    expect(suggestedReorder(0, 2, 10, "piece")).toBe(8);
  });

  it("suggests nothing for a non-selling product already at threshold", () => {
    expect(suggestedReorder(0, 10, 10, "piece")).toBe(0);
  });

  it("rounds part-units up so the order is placeable", () => {
    // 1 sold in 30 days -> 0.0333/day * 14 = 0.4667, +0 threshold, stock 0
    expect(suggestedReorder(1, 0, 0, "piece")).toBe(1);
  });

  it("orders weighed goods to a tenth of a kg", () => {
    // 30 kg in 30 days = 1/day -> 14 kg cover, stock 2.25 -> 11.75
    expect(suggestedReorder(30, 2.25, 0, "kg")).toBe(11.8);
  });

  it("uses the documented cover window", () => {
    // With no threshold and no stock, the suggestion is exactly the cover.
    expect(suggestedReorder(30, 0, 0, "piece")).toBe(COVER_DAYS);
  });

  it("handles a brisk seller with nothing left", () => {
    // 300 in 30 days = 10/day -> 140 + 24 threshold
    expect(suggestedReorder(300, 0, 24, "piece")).toBe(164);
  });
});

describe("roundUpForUnit", () => {
  it("rounds pieces up to whole units", () => {
    expect(roundUpForUnit(3.1, "piece")).toBe(4);
    expect(roundUpForUnit(3, "piece")).toBe(3);
  });

  it("rounds packs up to whole units", () => {
    expect(roundUpForUnit(0.2, "pack")).toBe(1);
  });

  it("rounds kg up to one decimal", () => {
    expect(roundUpForUnit(1.21, "kg")).toBe(1.3);
    expect(roundUpForUnit(1.2, "kg")).toBe(1.2);
  });
});

describe("daysOfStockLeft", () => {
  it("divides stock by the daily rate", () => {
    // 60 sold = 2/day, 10 on hand -> 5 days
    expect(daysOfStockLeft(60, 10)).toBe(5);
  });

  it("is unknown for a product with no sales", () => {
    expect(daysOfStockLeft(0, 10)).toBeNull();
  });
});

describe("lossValueCents", () => {
  it("values a write-off at the cost when it happened", () => {
    // 3 units written off at 4.80
    expect(lossValueCents(-3, 480)).toBe(1440);
  });

  it("treats found stock as no loss", () => {
    expect(lossValueCents(5, 480)).toBe(0);
  });

  it("values fractional kg losses", () => {
    expect(lossValueCents(-1.5, 600)).toBe(900);
  });

  it("is unknown when the cost was never recorded", () => {
    expect(lossValueCents(-3, null)).toBeNull();
  });
});

describe("daysNegative", () => {
  it("is null when the product is not currently negative", () => {
    expect(daysNegative(null)).toBeNull();
  });

  it("measures elapsed days since stock_went_negative_at", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    const wentNegativeAt = "2026-01-07T12:00:00.000Z";
    expect(daysNegative(wentNegativeAt, now)).toBeCloseTo(2.5, 5);
  });

  it("is never negative even if the timestamp is slightly in the future", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    const wentNegativeAt = "2026-01-10T00:00:01.000Z";
    expect(daysNegative(wentNegativeAt, now)).toBe(0);
  });
});
