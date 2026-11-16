import {
  MAX_BULK_PERCENT,
  MIN_BULK_PERCENT,
  previewBulkPrice,
  validBulkPercent,
  type BulkPriceProduct,
} from "@/src/lib/products/bulkPrice";

const product = (name: string, price: number, cost: number | null = null): BulkPriceProduct => ({
  name,
  selling_price_cents: price,
  current_cost_cents: cost,
});

describe("validBulkPercent", () => {
  it.each([5, -10, 0.5, MAX_BULK_PERCENT, MIN_BULK_PERCENT])("accepts %s", (percent) => {
    expect(validBulkPercent(percent)).toBe(true);
  });

  it.each([0, -100, -150, 1001, Number.NaN, Infinity])("refuses %s", (percent) => {
    expect(validBulkPercent(percent)).toBe(false);
  });
});

describe("previewBulkPrice", () => {
  it("applies the server's rounding: half up, never below zero", () => {
    const preview = previewBulkPrice([product("A", 1000), product("B", 150), product("C", 1)], -50);
    // 1000 -> 500, 150 -> 75, and 1 centime less half rounds back up to 1: unchanged
    expect(preview.changed).toBe(2);
    expect(preview.samples.map((sample) => [sample.before, sample.after])).toEqual([
      [1000, 500],
      [150, 75],
    ]);
  });

  it("counts only the products whose price really changes", () => {
    // +1% of 10 centimes is 0.1 centime: rounds to no change.
    const preview = previewBulkPrice([product("Cheap", 10), product("Dear", 1000)], 1);
    expect(preview).toMatchObject({ total: 2, changed: 1 });
  });

  it("shows first, middle and last of the changed products", () => {
    const products = Array.from({ length: 9 }, (_, i) => product(`P${i}`, 1000 + i * 100));
    const preview = previewBulkPrice(products, 10);
    expect(preview.samples.map((s) => s.name)).toEqual(["P0", "P4", "P8"]);
    expect(preview.samples[0]).toEqual({ name: "P0", before: 1000, after: 1100 });
  });

  it("copes with fewer products than samples, and none", () => {
    expect(previewBulkPrice([product("Only", 1000)], 10).samples).toHaveLength(1);
    expect(previewBulkPrice([], 10)).toEqual({
      changed: 0,
      total: 0,
      newlyBelowCost: 0,
      freeAfter: 0,
      samples: [],
    });
  });

  it("counts products pushed below their buying price, not ones already below", () => {
    const preview = previewBulkPrice(
      [
        product("Fine now, loss after", 1000, 800), // -20% = 800: equal, not below
        product("Loss after", 1000, 900), // -20% = 800 < 900
        product("Already a loss", 500, 700), // stays a loss: not newly
        product("No cost known", 1000, null),
        product("Cost zero", 1000, 0),
      ],
      -20
    );
    expect(preview.newlyBelowCost).toBe(1);
  });

  it("counts a price that would become free", () => {
    const preview = previewBulkPrice([product("Tiny", 1), product("Normal", 1000)], -99);
    // 1 centime less 99% rounds to 0; 1000 becomes 10
    expect(preview.freeAfter).toBe(1);
  });
});
