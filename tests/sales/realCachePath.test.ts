/**
 * Guard: a cart line built from the REAL offline cache must be accepted by the
 * REAL queue. No hand-written product or line fixture sits between them.
 *
 * Found live: the cache carries no cost column, JSON drops `undefined`, and the
 * strict queue reader then rejected every sale. Fixtures that spelled out
 * `current_cost_cents: null` hid it. Here the only input is what Supabase
 * returns; the cache writes it to storage and reads it back as the app does.
 */
import {
  findCachedByBarcode,
  refreshProductCache,
  searchCachedProducts,
} from "../../src/lib/products/offlineCache";
import { enqueueSale, listPendingSales } from "../../src/lib/sales/offlineQueue";
import { cartLineFrom } from "../../src/lib/sales/totals";
import { pendingSaleFrom } from "../../src/lib/sales/useSaleSync";

// A products_cashier_view row exactly as the server returns it: no cost column.
const SERVER_ROW = {
  id: "p1",
  barcode: "6111234567890",
  name: "Lait Centrale 1L",
  selling_price_cents: 750,
  unit: "piece",
  active: true,
  category_id: null,
  stock_quantity: 12,
  low_stock_threshold: 3,
};

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

function serverReturns(rows: unknown[]) {
  mockFrom.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "range"]) b[m] = () => b;
    b.then = (resolve: (v: unknown) => void) =>
      resolve({ data: table === "products_cashier_view" ? rows : [], error: null });
    return b;
  });
}

beforeEach(async () => {
  mockStore.clear();
  mockFrom.mockReset();
  serverReturns([SERVER_ROW]);
  await refreshProductCache(false);
});

const payment = {
  customer_id: null,
  payment_method: "cash" as const,
  discount_cents: 0,
  total_cents: 750,
};

describe("a line built from the real offline cache can be queued", () => {
  it("found by barcode", async () => {
    const product = await findCachedByBarcode(SERVER_ROW.barcode);
    expect(product).not.toBeNull();
    const line = cartLineFrom(product!, 1);
    await enqueueSale(pendingSaleFrom("sale-1", payment, [line], "user-a"));
    const [queued] = await listPendingSales();
    expect(queued.id).toBe("sale-1");
    expect(queued.lines[0]).toMatchObject({ product_id: "p1", unit_cost_cents: null });
  });

  it("found by search", async () => {
    const [product] = await searchCachedProducts("lait");
    await enqueueSale(pendingSaleFrom("sale-2", payment, [cartLineFrom(product, 2)], "user-a"));
    expect(await listPendingSales()).toHaveLength(1);
  });

  it("the cached product really has no cost key (so the guard can fail)", async () => {
    const product = await findCachedByBarcode(SERVER_ROW.barcode);
    expect("current_cost_cents" in product!).toBe(false);
  });

  it("a second sale still queues behind the first", async () => {
    const product = (await findCachedByBarcode(SERVER_ROW.barcode))!;
    await enqueueSale(pendingSaleFrom("a", payment, [cartLineFrom(product, 1)], "user-a"));
    await enqueueSale(pendingSaleFrom("b", payment, [cartLineFrom(product, 1)], "user-a"));
    expect((await listPendingSales()).map((s) => s.id)).toEqual(["a", "b"]);
  });
});
