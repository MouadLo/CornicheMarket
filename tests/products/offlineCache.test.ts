/**
 * Tests for the device-side product catalog cache.
 * Verifies barcode lookup and text search against a seeded cache, without
 * hitting Supabase (which is mocked to prevent env-var failures in CI).
 */
import {
  findCachedByBarcode,
  getCachedGrid,
  refreshProductCache,
  getProductCacheMeta,
  searchCachedProducts,
  type CachedProduct,
} from "../../src/lib/products/offlineCache";

// offlineCache imports supabase/client for refreshProductCache only; mock it
// so the module can be imported without real env vars.
const mockFrom = jest.fn();
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a) },
}));

const mockStore = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

const SEED: CachedProduct[] = [
  {
    id: "p1",
    barcode: "6111234567890",
    name: "Lait Centrale 1L",
    selling_price_cents: 750,
    unit: "piece",
    active: true,
  },
  {
    id: "p2",
    barcode: "6119876543210",
    name: "Pain de mie 500g",
    selling_price_cents: 550,
    unit: "piece",
    active: true,
  },
  {
    id: "p3",
    barcode: "6115555555555",
    name: "Huile Lesieur 1L",
    selling_price_cents: 1800,
    unit: "piece",
    active: true,
  },
  {
    id: "p4",
    barcode: "6110000000001",
    name: "Inactive product",
    selling_price_cents: 100,
    unit: "piece",
    active: false,
  },
];

function seedCache(products = SEED) {
  mockStore.set(
    "corniche.productCache.v1",
    JSON.stringify({ products, refreshedAt: "2026-10-26T10:00:00.000Z" })
  );
}

beforeEach(() => {
  mockStore.clear();
});

describe("getProductCacheMeta", () => {
  it("returns null when cache is empty", async () => {
    expect(await getProductCacheMeta()).toBeNull();
  });

  it("returns the refreshedAt timestamp when cache exists", async () => {
    seedCache();
    const meta = await getProductCacheMeta();
    expect(meta?.refreshedAt).toBe("2026-10-26T10:00:00.000Z");
  });
});

describe("findCachedByBarcode", () => {
  it("returns null when cache is empty", async () => {
    expect(await findCachedByBarcode("6111234567890")).toBeNull();
  });

  it("finds a product by exact barcode", async () => {
    seedCache();
    const result = await findCachedByBarcode("6111234567890");
    expect(result?.id).toBe("p1");
    expect(result?.name).toBe("Lait Centrale 1L");
  });

  it("returns null for an unknown barcode", async () => {
    seedCache();
    expect(await findCachedByBarcode("0000000000000")).toBeNull();
  });

  it("does not return inactive products", async () => {
    seedCache();
    expect(await findCachedByBarcode("6110000000001")).toBeNull();
  });
});

describe("searchCachedProducts", () => {
  it("returns empty array when cache is empty", async () => {
    expect(await searchCachedProducts("lait")).toEqual([]);
  });

  it("finds products by name (case-insensitive)", async () => {
    seedCache();
    const results = await searchCachedProducts("LAIT");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("p1");
  });

  it("finds products by barcode prefix", async () => {
    seedCache();
    const results = await searchCachedProducts("6119");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("p2");
  });

  it("returns up to the requested limit", async () => {
    const many: CachedProduct[] = Array.from({ length: 20 }, (_, i) => ({
      id: `px${i}`,
      barcode: null,
      name: `Product ${i}`,
      selling_price_cents: 100,
      unit: "piece" as const,
      active: true,
    }));
    seedCache(many);
    const results = await searchCachedProducts("product", 5);
    expect(results).toHaveLength(5);
  });

  it("excludes inactive products from results", async () => {
    seedCache();
    const results = await searchCachedProducts("inactive");
    expect(results).toHaveLength(0);
  });
});

describe("cache v2 (the Sell grid)", () => {
  // A query builder that resolves to the rows given per table.
  function rows(byTable: Record<string, unknown[] | Error>) {
    mockFrom.mockImplementation((table: string) => {
      const result = byTable[table];
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "range"]) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(
          result instanceof Error
            ? { data: null, error: { message: result.message } }
            : { data: result ?? [], error: null }
        );
      return builder;
    });
  }
  const grid = {
    sell_grid_tabs: [
      {
        id: "t1",
        kind: "favorites",
        category_id: null,
        label: null,
        position: 0,
        visible: true,
        auto_fill: false,
      },
    ],
    sell_grid_tiles: [],
    categories: [{ id: "c1", name: "Boissons" }],
  };

  beforeEach(() => mockFrom.mockReset());

  it("never stores a cost column", async () => {
    rows({ products_cashier_view: SEED, ...grid });
    await refreshProductCache(false);
    const stored = mockStore.get("corniche.productCache.v2") ?? "";
    expect(stored).not.toMatch(/cost/i);
    expect(stored).toContain('"tabs"');
  });

  it("an owner's refresh asks for the grid fields only, never a cost column", async () => {
    const selected: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      const b: Record<string, unknown> = {};
      b.select = (cols: string) => (selected.push(`${table}:${cols}`), b);
      for (const m of ["eq", "order", "range"]) b[m] = () => b;
      b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return b;
    });
    await refreshProductCache(true);
    expect(selected.filter((s) => /cost/i.test(s))).toEqual([]);
    expect(selected.some((s) => s.startsWith("products:") && s.includes("stock_quantity"))).toBe(
      true
    );
  });

  it("writes v2 with products, categories and the layout, and drops v1", async () => {
    seedCache();
    rows({ products_cashier_view: SEED, ...grid });
    await refreshProductCache(false);
    expect(mockStore.has("corniche.productCache.v1")).toBe(false);
    const g = await getCachedGrid();
    expect(g?.products).toHaveLength(SEED.length);
    expect(g?.categories).toEqual([{ id: "c1", name: "Boissons" }]);
    expect(g?.tabs).toHaveLength(1);
  });

  it("still serves a device that has only the v1 cache (barcode and search keep working)", async () => {
    seedCache();
    expect((await findCachedByBarcode("6111234567890"))?.name).toBe("Lait Centrale 1L");
    expect((await getCachedGrid())?.tabs).toEqual([]); // no layout yet: Sell looks as before
  });

  it("if the grid tables fail, products and prices still refresh and the last layout is kept", async () => {
    mockStore.set(
      "corniche.productCache.v2",
      JSON.stringify({
        products: [],
        categories: [{ id: "old", name: "Old" }],
        grid: { tabs: [{ id: "keep" }], tiles: [] },
        refreshedAt: "2026-10-26T10:00:00.000Z",
      })
    );
    rows({
      products_cashier_view: SEED,
      sell_grid_tabs: new Error("relation does not exist"),
      sell_grid_tiles: [],
      categories: [],
    });
    await refreshProductCache(false);
    const g = await getCachedGrid();
    expect(g?.products).toHaveLength(SEED.length); // refreshed
    expect(g?.tabs).toEqual([{ id: "keep" }]); // layout kept
  });

  it("getCachedGrid is null when nothing is cached", async () => {
    expect(await getCachedGrid()).toBeNull();
  });
});
