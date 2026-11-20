import { fetchProductByBarcode, findByBarcode } from "../../src/lib/products/queries";

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
  {
    id: "upc",
    name: "US chips",
    barcode: "036000291452",
    unit: "piece",
    selling_price_cents: 1500,
    current_cost_cents: 1000,
    active: true,
  },
  {
    id: "upce",
    name: "Small can",
    barcode: "04252614",
    unit: "piece",
    selling_price_cents: 800,
    current_cost_cents: 500,
    active: true,
  },
  {
    id: "twin12",
    name: "Saved as 12 digits",
    barcode: "012345000072",
    unit: "piece",
    selling_price_cents: 100,
    current_cost_cents: 50,
    active: true,
  },
  {
    id: "twin13",
    name: "Saved as 13 digits",
    barcode: "0012345000072",
    unit: "piece",
    selling_price_cents: 200,
    current_cost_cents: 50,
    active: true,
  },
];

const mockCalls: { source: string; columns: string }[] = [];
let mockFailWith: string | null = null;

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    from: (source: string) => {
      const filters: [string, (value: unknown) => boolean][] = [];
      let columns = "";
      const builder = {
        select: (cols: string) => {
          columns = cols;
          mockCalls.push({ source, columns: cols });
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, (v: unknown) => v === value]);
          return builder;
        },
        // Exact membership, like PostgREST's in.(…): no prefix matching.
        in: (column: string, values: unknown[]) => {
          filters.push([column, (v: unknown) => values.includes(v)]);
          return builder;
        },
        limit: async () => {
          if (mockFailWith) return { data: null, error: { message: mockFailWith } };
          const wanted = columns.split(",").map((c) => c.trim());
          const rows = mockTable.filter((r) => filters.every(([c, test]) => test(r[c])));
          return {
            data: rows.map((row) => Object.fromEntries(wanted.map((c) => [c, row[c]]))),
            error: null,
          };
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

describe("fetchProductByBarcode: the same product read by different scanners", () => {
  it("an iPhone's 13-digit read finds the product saved with the 12-digit UPC-A", async () => {
    expect(await fetchProductByBarcode("0036000291452", false)).toMatchObject({ id: "upc" });
  });

  it("a 12-digit read still finds it, and so does a GTIN-14", async () => {
    expect(await fetchProductByBarcode("036000291452", false)).toMatchObject({ id: "upc" });
    expect(await fetchProductByBarcode("00036000291452", false)).toMatchObject({ id: "upc" });
  });

  it("a reader that expands UPC-E finds the product saved with the short code", async () => {
    expect(await fetchProductByBarcode("042100005264", false)).toMatchObject({ id: "upce" });
    expect(await fetchProductByBarcode("0042100005264", false)).toMatchObject({ id: "upce" });
  });

  it("when both forms are saved, the exact text wins", async () => {
    expect(await fetchProductByBarcode("012345000072", false)).toMatchObject({ id: "twin12" });
    expect(await fetchProductByBarcode("0012345000072", false)).toMatchObject({ id: "twin13" });
  });

  it("an EAN-13 that does not start with 0 is never shortened", async () => {
    expect(await fetchProductByBarcode("111234567890", false)).toBeNull();
  });
});

describe("findByBarcode (duplicate warning, receiving)", () => {
  it("finds a product saved with an equivalent form, inactive ones included", async () => {
    expect(await findByBarcode("0036000291452", true)).toEqual({ id: "upc", name: "US chips" });
    expect(await findByBarcode("6119999999999", true)).toEqual({
      id: "old",
      name: "Discontinued",
    });
    expect(await findByBarcode("6111234", true)).toBeNull();
  });
});
