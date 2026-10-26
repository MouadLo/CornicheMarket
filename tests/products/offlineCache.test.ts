/**
 * Tests for the device-side product catalog cache.
 * Verifies barcode lookup and text search against a seeded cache, without
 * hitting Supabase (which is mocked to prevent env-var failures in CI).
 */
import {
  findCachedByBarcode,
  getProductCacheMeta,
  searchCachedProducts,
  type CachedProduct,
} from "../../src/lib/products/offlineCache";

// offlineCache imports supabase/client for refreshProductCache only; mock it
// so the module can be imported without real env vars.
jest.mock("../../src/lib/supabase/client", () => ({ supabase: { from: jest.fn() } }));

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
