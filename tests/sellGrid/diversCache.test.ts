// The Divers product id and the cashier's maximum live in the offline cache, so
// the pad works offline, and the cache still holds no cost data.
import { getCachedGrid, refreshProductCache } from "../../src/lib/products/offlineCache";
import { fetchDiversConfig } from "../../src/lib/sellGrid/queries";

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

type Backend = {
  diversProduct?: { id: string } | null | Error;
  settings?: { divers_max_cents: number } | null | Error;
};
const selected: string[] = [];

// A query builder: lists resolve to [], single reads to what the backend gives.
function backend(b: Backend) {
  mockFrom.mockImplementation((table: string) => {
    let columns = "";
    const builder: Record<string, unknown> = {};
    builder.select = (cols: string) => {
      columns = cols;
      selected.push(`${table}:${cols}`);
      return builder;
    };
    for (const m of ["eq", "order", "range"]) builder[m] = () => builder;
    const single = (): { data: unknown; error: { message: string } | null } => {
      const value =
        table === "products_cashier_view" && columns === "id"
          ? b.diversProduct
          : table === "store_settings"
            ? b.settings
            : null;
      return value instanceof Error
        ? { data: null, error: { message: value.message } }
        : { data: value ?? null, error: null };
    };
    builder.maybeSingle = async () => single();
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return builder;
  });
}

beforeEach(() => {
  mockFrom.mockReset();
  mockStore.clear();
  selected.length = 0;
});

describe("fetchDiversConfig", () => {
  it("reads the product id and the cashier maximum", async () => {
    backend({ diversProduct: { id: "d1" }, settings: { divers_max_cents: 30000 } });
    expect(await fetchDiversConfig()).toEqual({ productId: "d1", maxCents: 30000 });
  });

  it("is null when the database has no Divers product", async () => {
    backend({ diversProduct: null, settings: { divers_max_cents: 20000 } });
    expect(await fetchDiversConfig()).toBeNull();
  });

  it("throws on a read error instead of pretending there is none", async () => {
    backend({ diversProduct: new Error("boom"), settings: { divers_max_cents: 20000 } });
    await expect(fetchDiversConfig()).rejects.toThrow("boom");
  });
});

describe("the cache holds Divers", () => {
  it("a refresh stores the id and the maximum, and never a cost", async () => {
    backend({ diversProduct: { id: "d1" }, settings: { divers_max_cents: 20000 } });
    await refreshProductCache(false);
    expect((await getCachedGrid())?.divers).toEqual({ productId: "d1", maxCents: 20000 });
    const stored = mockStore.get("corniche.productCache.v2") ?? "";
    expect(stored).toContain('"productId":"d1"');
    expect(stored).not.toMatch(/cost/i);
    expect(stored).not.toMatch(/margin/i);
    expect(selected.filter((s) => /cost|margin/i.test(s))).toEqual([]);
  });

  it("an owner's refresh asks for the same two things and no cost either", async () => {
    backend({ diversProduct: { id: "d1" }, settings: { divers_max_cents: 20000 } });
    await refreshProductCache(true);
    expect(selected.filter((s) => /cost|margin/i.test(s))).toEqual([]);
    expect((await getCachedGrid())?.divers?.productId).toBe("d1");
  });

  it("a cache written before Divers has none: the tile stays hidden, nothing breaks", async () => {
    mockStore.set(
      "corniche.productCache.v2",
      JSON.stringify({ products: [], refreshedAt: "2026-10-26T10:00:00.000Z" })
    );
    expect((await getCachedGrid())?.divers).toBeNull();
  });

  it("a malformed Divers entry is read as none", async () => {
    mockStore.set(
      "corniche.productCache.v2",
      JSON.stringify({
        products: [],
        divers: { productId: 5, maxCents: "x" },
        refreshedAt: "2026-10-26T10:00:00.000Z",
      })
    );
    expect((await getCachedGrid())?.divers).toBeNull();
  });

  it("a failed read keeps the last known Divers instead of erasing it", async () => {
    mockStore.set(
      "corniche.productCache.v2",
      JSON.stringify({
        products: [],
        divers: { productId: "d-old", maxCents: 15000 },
        refreshedAt: "2026-10-26T10:00:00.000Z",
      })
    );
    backend({ diversProduct: new Error("offline"), settings: { divers_max_cents: 20000 } });
    await refreshProductCache(false);
    expect((await getCachedGrid())?.divers).toEqual({ productId: "d-old", maxCents: 15000 });
  });

  it("a database with no Divers product clears an old entry", async () => {
    mockStore.set(
      "corniche.productCache.v2",
      JSON.stringify({
        products: [],
        divers: { productId: "d-old", maxCents: 15000 },
        refreshedAt: "2026-10-26T10:00:00.000Z",
      })
    );
    backend({ diversProduct: null, settings: { divers_max_cents: 20000 } });
    await refreshProductCache(false);
    expect((await getCachedGrid())?.divers).toBeNull();
  });
});
