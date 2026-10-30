import { fetchProductByBarcode } from "../../src/lib/products/queries";

// A tiny stand-in for PostgREST that understands exactly the filters an exact
// lookup needs. Any fuzzy filter (or(), ilike, like) throws, so a query that
// falls back to "starts with" / "contains" matching cannot pass this suite.
type Row = Record<string, unknown>;
const mockTable: Row[] = [
  {
    id: "milk",
    name: "Milk 1L",
    barcode: "6111234567890",
    unit: "piece",
    selling_price_cents: 700,
    current_cost_cents: 500,
    active: true,
  },
  {
    id: "pack",
    name: "Pack 6111234",
    barcode: "9990000000017",
    unit: "piece",
    selling_price_cents: 900,
    current_cost_cents: 600,
    active: true,
  },
  {
    id: "old",
    name: "Discontinued",
    barcode: "6119999999999",
    unit: "piece",
    selling_price_cents: 100,
    current_cost_cents: 50,
    active: false,
  },
];

const mockCalls: { source: string; columns: string }[] = [];
let mockFailWith: string | null = null;

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    from: (source: string) => {
      const filters: [string, unknown][] = [];
      let columns = "";
      const builder = {
        select: (cols: string) => {
          columns = cols;
          mockCalls.push({ source, columns: cols });
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => {
          if (mockFailWith) return { data: null, error: { message: mockFailWith } };
          const wanted = columns.split(",").map((c) => c.trim());
          const row = mockTable.find((r) => filters.every(([c, v]) => r[c] === v));
          const picked = row && Object.fromEntries(wanted.map((c) => [c, row[c]]));
          return { data: picked ?? null, error: null };
        },
        or: () => {
          throw new Error("fuzzy or() filter used for a barcode lookup");
        },
        ilike: () => {
          throw new Error("fuzzy ilike filter used for a barcode lookup");
        },
      };
      return builder;
    },
  },
}));

beforeEach(() => {
  mockCalls.length = 0;
  mockFailWith = null;
});

describe("fetchProductByBarcode: exact match on the barcode column", () => {
  it("returns the product whose barcode equals the code exactly", async () => {
    const product = await fetchProductByBarcode("6111234567890", false);
    expect(product).toMatchObject({ id: "milk", selling_price_cents: 700 });
  });

  it("never returns a product for a partial barcode (prefix)", async () => {
    expect(await fetchProductByBarcode("611123456789", false)).toBeNull();
    expect(await fetchProductByBarcode("6111234", false)).toBeNull();
  });

  it("never matches a product NAME that contains the digits", async () => {
    // "Pack 6111234" is named after those digits but has a different barcode.
    expect(await fetchProductByBarcode("6111234", false)).toBeNull();
  });

  it("does not return inactive products", async () => {
    expect(await fetchProductByBarcode("6119999999999", false)).toBeNull();
  });

  it("returns null (not a throw) for an unknown code", async () => {
    expect(await fetchProductByBarcode("0000000000000", false)).toBeNull();
  });

  it("cashiers read the cost-free view and never receive a cost", async () => {
    const product = await fetchProductByBarcode("6111234567890", false);
    expect(mockCalls[0].source).toBe("products_cashier_view");
    expect(mockCalls[0].columns).not.toMatch(/cost/);
    expect(product?.current_cost_cents).toBeNull();
  });

  it("owners read products and get the cost", async () => {
    const product = await fetchProductByBarcode("6111234567890", true);
    expect(mockCalls[0].source).toBe("products");
    expect(product?.current_cost_cents).toBe(500);
  });

  it("surfaces a query error instead of reporting 'unknown barcode'", async () => {
    mockFailWith = "network down";
    await expect(fetchProductByBarcode("6111234567890", false)).rejects.toThrow("network down");
  });
});
