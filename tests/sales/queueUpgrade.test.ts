/**
 * A queue written by an older build must never break selling after an update.
 *
 * Found live: a stored sale whose lines lack `unit_cost_cents` (older builds
 * stored products from the offline cache, which carry no cost, and JSON drops
 * `undefined`) made the strict reader reject the WHOLE queue, so every enqueue
 * and every sync threw "Invalid sales storage" and the Sell screen was dead.
 *
 * Rules pinned here:
 *   - known old shapes are migrated forward on read, nothing is lost;
 *   - an entry that cannot be understood is moved aside, byte for byte, into the
 *     unreadable list (copy first, then remove) and never blocks the others;
 *   - if the copy cannot be written, the operation fails and storage is untouched;
 *   - storage that is not even a JSON array is still left exactly as it is (C02).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  countUnreadableSales,
  enqueueSale,
  exportRawSalesStorage,
  listPendingSales,
  listSalesOfOthers,
  listStuckSales,
  listUnreadableSales,
  type PendingSale,
} from "../../src/lib/sales/offlineQueue";
import { pendingSaleFrom, syncPendingSales } from "../../src/lib/sales/useSaleSync";

const mockSubmitSale = jest.fn();
const mockGetSession = jest.fn();
jest.mock("../../src/lib/sales/queries", () => ({
  submitSale: (...args: unknown[]) => mockSubmitSale(...args),
  fetchCustomers: jest.fn(),
  voidSale: jest.fn(),
}));
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: jest.fn(),
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
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

const PENDING = "corniche.pendingSales.v1";
const STUCK = "corniche.stuckSales.v1";
const UNREADABLE = "corniche.unreadableSales.v1";
const A = "user-a";

// What an older build wrote: no cashier_id, and lines without a cost key.
const oldLine = {
  product_id: "p1",
  name: "Old milk",
  unit: "piece",
  quantity: 1,
  unit_price_cents: 700,
  discount_cents: 0,
};
const oldSale = {
  id: "old-1",
  customer_id: null,
  payment_method: "cash",
  discount_cents: 0,
  total_cents: 700,
  created_at: "2026-10-01T10:00:00.000Z",
  attempts: 0,
  lines: [oldLine],
};
const garbage = { id: "incomplete" };

function fresh(id: string, cashier = A): PendingSale {
  return pendingSaleFrom(
    id,
    { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 1200 },
    [{ ...oldLine, unit_cost_cents: null }],
    cashier
  );
}

beforeEach(() => {
  mockStore.clear();
  mockSubmitSale.mockReset();
  mockSubmitSale.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: A } } } });
});

describe("old-format sales are migrated forward, not rejected", () => {
  it("a queue with a sale whose lines have no cost key does not block selling", async () => {
    mockStore.set(PENDING, JSON.stringify([oldSale]));
    await enqueueSale(fresh("new-1"));
    const queue = await listPendingSales();
    expect(queue.map((s) => s.id)).toEqual(["old-1", "new-1"]);
  });

  it("the migrated sale keeps everything and gains an explicit null cost", async () => {
    mockStore.set(PENDING, JSON.stringify([oldSale]));
    const [migrated] = await listPendingSales();
    expect(migrated).toMatchObject({
      id: "old-1",
      total_cents: 700,
      created_at: oldSale.created_at,
    });
    expect(migrated.lines[0]).toEqual({ ...oldLine, unit_cost_cents: null });
    expect(migrated.cashier_id).toBeUndefined(); // still legacy: never sent automatically
  });

  it("fills the other fields an old build could omit, and nothing else", async () => {
    const sparse = {
      id: "old-2",
      payment_method: "card",
      total_cents: 500,
      created_at: "2026-09-01T10:00:00.000Z",
      last_error: null,
      lines: [{ ...oldLine, discount_cents: undefined }],
    };
    mockStore.set(PENDING, JSON.stringify([sparse]));
    const [migrated] = await listPendingSales();
    expect(migrated).toMatchObject({
      id: "old-2",
      customer_id: null,
      discount_cents: 0,
      attempts: 0,
      total_cents: 500,
      payment_method: "card",
    });
    expect(migrated.last_error).toBeUndefined();
    expect(migrated.lines[0].discount_cents).toBe(0);
  });

  it("a migrated stuck sale is readable too", async () => {
    mockStore.set(
      STUCK,
      JSON.stringify([{ sale: oldSale, error: "rejected", failedAt: "2026-10-02T10:00:00.000Z" }])
    );
    const [entry] = await listStuckSales();
    expect(entry.sale.lines[0].unit_cost_cents).toBeNull();
    expect(entry.error).toBe("rejected");
  });

  it("a migrated legacy sale stays in the owner's recovery list and is never sent", async () => {
    mockStore.set(PENDING, JSON.stringify([oldSale]));
    await syncPendingSales(A);
    expect(mockSubmitSale).not.toHaveBeenCalled();
    expect((await listSalesOfOthers("owner")).map((s) => s.id)).toEqual(["old-1"]);
  });

  it("after the update, a user's new sale still syncs; the legacy one waits", async () => {
    mockStore.set(PENDING, JSON.stringify([oldSale]));
    await enqueueSale(fresh("new-1"));
    await syncPendingSales(A);
    expect(mockSubmitSale.mock.calls.map(([s]) => s.id)).toEqual(["new-1"]);
    expect((await listPendingSales()).map((s) => s.id)).toEqual(["old-1"]);
  });
});

describe("a line picked from the offline cache (no cost field) is accepted", () => {
  it("enqueueSale stores an undefined cost as null instead of refusing the sale", async () => {
    const fromCache = fresh("cache-1");
    (fromCache.lines[0] as { unit_cost_cents?: number | null }).unit_cost_cents = undefined;
    await enqueueSale(fromCache);
    expect((await listPendingSales())[0].lines[0].unit_cost_cents).toBeNull();
  });
});

describe("an entry that cannot be understood is set aside, never destroyed", () => {
  it("does not block selling, and is kept byte for byte", async () => {
    mockStore.set(PENDING, JSON.stringify([oldSale, garbage]));
    await enqueueSale(fresh("new-1"));
    expect((await listPendingSales()).map((s) => s.id)).toEqual(["old-1", "new-1"]);
    const set = await listUnreadableSales();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({ source: "pending", raw: garbage });
    expect(await countUnreadableSales()).toBe(1);
  });

  it("the raw recovery export includes it", async () => {
    mockStore.set(PENDING, JSON.stringify([garbage]));
    await listPendingSales();
    const exported = await exportRawSalesStorage();
    expect(JSON.parse(exported.unreadable as string)[0].raw).toEqual(garbage);
  });

  it("an unreadable stuck entry is set aside too", async () => {
    mockStore.set(STUCK, JSON.stringify([{ sale: garbage, error: "x", failedAt: "t" }]));
    expect(await listStuckSales()).toEqual([]);
    expect((await listUnreadableSales())[0]).toMatchObject({ source: "stuck" });
  });

  it("reading again does not duplicate it", async () => {
    mockStore.set(PENDING, JSON.stringify([garbage]));
    await listPendingSales();
    await listPendingSales();
    expect(await countUnreadableSales()).toBe(1);
  });

  it("if the copy cannot be written, the read fails and the queue is untouched", async () => {
    const raw = JSON.stringify([oldSale, garbage]);
    mockStore.set(PENDING, raw);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key: string, value: string) => {
      if (key === UNREADABLE) throw new Error("disk full");
      mockStore.set(key, value);
    });
    await expect(enqueueSale(fresh("new-1"))).rejects.toThrow("disk full");
    expect(mockStore.get(PENDING)).toBe(raw);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key: string, value: string) => {
      mockStore.set(key, value);
    });
  });

  it("storage that is not a JSON array is still left exactly as it is", async () => {
    mockStore.set(PENDING, "{broken");
    await expect(enqueueSale(fresh("new-1"))).rejects.toThrow("Original data preserved");
    expect(mockStore.get(PENDING)).toBe("{broken");
    expect(mockStore.has(UNREADABLE)).toBe(false);
  });
});
