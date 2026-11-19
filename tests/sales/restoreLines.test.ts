import { restoreLine, restoreLines, restoreSaleDiscount } from "../../src/lib/sales/restoreLines";
import type { CartLine } from "../../src/lib/sales/totals";

const line = (id: string, quantity = 1): CartLine => ({
  product_id: id,
  name: id,
  unit: "piece",
  quantity,
  unit_price_cents: 700,
  discount_cents: 0,
  unit_cost_cents: null,
  discountable: true,
});
const ids = (lines: CartLine[]) => lines.map((l) => l.product_id);

describe("restoreLine", () => {
  it("puts the line back at its old position", () => {
    expect(ids(restoreLine([line("a"), line("c")], line("b"), 1))).toEqual(["a", "b", "c"]);
  });
  it("goes to the end when the basket is now shorter", () => {
    expect(ids(restoreLine([line("a")], line("b"), 5))).toEqual(["a", "b"]);
  });
  it("keeps quantity and discount exactly", () => {
    const removed = { ...line("b", 2.5), discount_cents: 30 };
    expect(restoreLine([], removed, 0)[0]).toEqual(removed);
  });
  it("skips a product that was added again meanwhile", () => {
    const current = [line("b", 3)];
    expect(restoreLine(current, line("b", 1), 0)).toBe(current);
  });
});

describe("restoreLines", () => {
  it("brings all lines back, in order, before lines added since", () => {
    expect(ids(restoreLines([line("z")], [line("a"), line("b")]))).toEqual(["a", "b", "z"]);
  });
  it("skips products that are already back", () => {
    const result = restoreLines([line("a", 4)], [line("a"), line("b")]);
    expect(ids(result)).toEqual(["b", "a"]);
    expect(result[1].quantity).toBe(4);
  });
});

describe("restoreSaleDiscount", () => {
  it("restores when none was typed since", () => {
    expect(restoreSaleDiscount("", "5.00")).toBe("5.00");
    expect(restoreSaleDiscount("  ", "5.00")).toBe("5.00");
  });
  it("keeps a discount typed since", () => {
    expect(restoreSaleDiscount("2", "5.00")).toBe("2");
  });
});
