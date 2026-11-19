import {
  autoDiscountable,
  cashierDiscountLimitCents,
  cashierDiscountProblem,
  DEFAULT_DISCOUNT_LIMITS,
  effectiveDiscountable,
  remainingSaleDiscountCents,
} from "../../src/lib/sales/discountLimit";
import type { CartLine } from "../../src/lib/sales/totals";

const L = DEFAULT_DISCOUNT_LIMITS;
const SEVEN_HALF = { percent: 7.5, maxCents: 2000 };

function line(
  id: string,
  quantity: number,
  price: number,
  discountable: boolean,
  discount = 0
): CartLine {
  return {
    product_id: id,
    name: id,
    unit: "piece",
    quantity,
    unit_price_cents: price,
    discount_cents: discount,
    unit_cost_cents: null,
    discountable,
  };
}

describe("cashierDiscountLimitCents", () => {
  it("is 5% of the discountable items", () => {
    expect(cashierDiscountLimitCents([line("a", 2, 5000, true)], L)).toBe(500);
  });
  it("rounds down to the centime", () => {
    expect(cashierDiscountLimitCents([line("a", 1, 999, true)], L)).toBe(49);
  });
  it("is capped at 20 DH on a 600 DH basket", () => {
    expect(cashierDiscountLimitCents([line("a", 1, 60000, true)], L)).toBe(2000);
  });
  it("counts only discountable items in a cigarettes + other mix", () => {
    const lines = [line("cig", 1, 6000, false), line("other", 1, 4000, true)];
    expect(cashierDiscountLimitCents(lines, L)).toBe(200);
  });
  it("is 0 on a basket of only blocked items", () => {
    expect(cashierDiscountLimitCents([line("cig", 3, 6000, false)], L)).toBe(0);
  });
  it("handles weighted quantities with the line rounding the server uses", () => {
    // 1.234 kg x 3333 = 4113 after rounding; 5% = 205.65 -> 205
    expect(cashierDiscountLimitCents([line("kg", 1.234, 3333, true)], L)).toBe(205);
  });
  it("handles fractional percents without float drift", () => {
    expect(cashierDiscountLimitCents([line("a", 1, 10000, true)], SEVEN_HALF)).toBe(750);
    expect(
      cashierDiscountLimitCents([line("a", 1, 10000, true)], { percent: 0.29, maxCents: 2000 })
    ).toBe(29);
  });
});

describe("cashierDiscountProblem", () => {
  it("is null within the limit, line and sale discounts together", () => {
    expect(cashierDiscountProblem([line("a", 1, 10000, true, 200)], 300, L)).toBeNull();
  });
  it("reports over when line + sale discounts exceed it", () => {
    expect(cashierDiscountProblem([line("a", 1, 10000, true, 200)], 301, L)).toEqual({
      kind: "over",
      limitCents: 500,
      totalCents: 501,
    });
  });
  it("reports a discount on a blocked line first", () => {
    const lines = [line("cig", 1, 6000, false, 100), line("x", 1, 4000, true)];
    expect(cashierDiscountProblem(lines, 0, L)).toEqual({ kind: "blocked", lineIds: ["cig"] });
  });
  it("refuses any sale discount on a basket of only blocked items", () => {
    expect(cashierDiscountProblem([line("cig", 1, 6000, false)], 1, L)).toEqual({
      kind: "over",
      limitCents: 0,
      totalCents: 1,
    });
  });
  it("is null with no discount at all", () => {
    expect(cashierDiscountProblem([line("cig", 1, 6000, false)], 0, L)).toBeNull();
  });
});

describe("remainingSaleDiscountCents", () => {
  it("is what the line discounts leave", () => {
    expect(remainingSaleDiscountCents([line("a", 1, 10000, true, 200)], L)).toBe(300);
  });
  it("never goes below 0", () => {
    expect(remainingSaleDiscountCents([line("a", 1, 10000, true, 900)], L)).toBe(0);
  });
});

describe("autoDiscountable", () => {
  it("allows a 5% margin and refuses 4%", () => {
    expect(autoDiscountable({ priceCents: 10000, costCents: 9500 }, L)).toBe(true);
    expect(autoDiscountable({ priceCents: 10000, costCents: 9600 }, L)).toBe(false);
  });
  it("refuses a product with no buying price", () => {
    expect(autoDiscountable({ priceCents: 10000, costCents: null }, L)).toBe(false);
    expect(autoDiscountable({ priceCents: 10000, costCents: 0 }, L)).toBe(false);
  });
  it("refuses a free product", () => {
    expect(autoDiscountable({ priceCents: 0, costCents: 100 }, L)).toBe(false);
  });
  it("follows a changed limit", () => {
    expect(autoDiscountable({ priceCents: 10000, costCents: 9200 }, SEVEN_HALF)).toBe(true);
    expect(autoDiscountable({ priceCents: 10000, costCents: 9300 }, SEVEN_HALF)).toBe(false);
  });
  it("judges Divers by its estimated margin", () => {
    const divers = { priceCents: 0, costCents: null, kind: "misc" };
    expect(autoDiscountable(divers, L, 20)).toBe(true);
    expect(autoDiscountable(divers, L, 4)).toBe(false);
    expect(autoDiscountable(divers, L)).toBe(false);
  });
});

describe("effectiveDiscountable", () => {
  it("lets the override win", () => {
    expect(effectiveDiscountable("allow", false)).toBe(true);
    expect(effectiveDiscountable("block", true)).toBe(false);
    expect(effectiveDiscountable(null, true)).toBe(true);
    expect(effectiveDiscountable(null, false)).toBe(false);
  });
});
