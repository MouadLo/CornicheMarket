import { importProducts } from "../../src/lib/products/import";
import type { ParsedRow } from "../../src/lib/products/csv";

const mockInsertResults: { data: unknown; error: { message: string } | null }[] = [];
let mockCall = 0;

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    from: () => {
      const builder = {
        insert: () => builder,
        select: () => builder,
        single: () => Promise.resolve(mockInsertResults[mockCall++]),
        then: (resolve: (v: unknown) => unknown) => resolve(mockInsertResults[mockCall++]),
      };
      return builder;
    },
  },
}));

const row = (rowNumber: number, opening = false): ParsedRow => ({
  rowNumber,
  product: {
    name: `P${rowNumber}`,
    barcode: null,
    category_id: null,
    unit: "piece",
    selling_price_cents: 100,
    low_stock_threshold: 0,
    active: true,
  },
  opening: opening ? { quantity: 2, unit_cost_cents: 50 } : null,
});

beforeEach(() => {
  mockInsertResults.length = 0;
  mockCall = 0;
});

it("reports a refused chunk by row, as translation keys and never the server text", async () => {
  mockInsertResults.push({
    data: null,
    error: { message: 'duplicate key value violates unique constraint "idx_products_barcode"' },
  });
  const result = await importProducts([row(2), row(3)], "owner-1");
  expect(result.inserted).toBe(0);
  expect(result.errors).toEqual([
    { rowNumber: 2, issues: [{ key: "errors.duplicateBarcode" }] },
    { rowNumber: 3, issues: [{ key: "errors.duplicateBarcode" }] },
  ]);
  expect(JSON.stringify(result.errors)).not.toContain("duplicate key");
});

it("an unknown refusal becomes the generic key", async () => {
  mockInsertResults.push({ data: null, error: { message: "weird internal failure 0x80" } });
  const result = await importProducts([row(2)], "owner-1");
  expect(result.errors[0].issues).toEqual([{ key: "errors.generic" }]);
});

it("says that opening stock was not recorded, and why", async () => {
  mockInsertResults.push({ data: [{ id: "p1" }], error: null });
  mockInsertResults.push({ data: null, error: { message: "Failed to fetch" } });
  const result = await importProducts([row(2, true)], "owner-1");
  expect(result.inserted).toBe(1);
  expect(result.errors).toEqual([
    {
      rowNumber: 0,
      issues: [{ key: "products.importIssue.openingFailedAll" }, { key: "errors.network" }],
    },
  ]);
});
