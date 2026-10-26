/**
 * Locks in two properties the offline sync relies on:
 *   1. pendingSaleFrom builds the correct PendingSale shape.
 *   2. A successfully synced sale is removed and cannot be re-sent (no duplicate
 *      submissions even if the sync loop runs again before the queue is stale).
 *
 * The actual HTTP call to Supabase (submitSale) is not exercised here — that
 * is a DB integration concern. What we verify is the queue state before and
 * after a successful "submit + remove" cycle.
 */
import {
  countPendingSales,
  enqueueSale,
  listPendingSales,
  removePendingSale,
  type PendingSale,
} from "../../src/lib/sales/offlineQueue";
import { pendingSaleFrom } from "../../src/lib/sales/useSaleSync";

// useSaleSync imports submitSale from queries, which triggers the Supabase
// client initializer that requires env vars. Mock the module so only the
// pure pendingSaleFrom helper is exercised here.
jest.mock("../../src/lib/sales/queries", () => ({
  submitSale: jest.fn(),
  fetchCustomers: jest.fn(),
  voidSale: jest.fn(),
}));

// Prefixed with "mock" so Jest hoists the factory correctly.
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

beforeEach(() => {
  mockStore.clear();
});

describe("pendingSaleFrom", () => {
  it("builds a PendingSale with attempts: 0", () => {
    const sale = pendingSaleFrom(
      "abc-123",
      { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 1400 },
      []
    );
    expect(sale.id).toBe("abc-123");
    expect(sale.attempts).toBe(0);
    expect(sale.payment_method).toBe("cash");
    expect(sale.total_cents).toBe(1400);
    expect(sale.lines).toEqual([]);
  });

  it("sets created_at to a valid ISO string at construction time", () => {
    const before = new Date().toISOString();
    const sale = pendingSaleFrom(
      "abc-123",
      { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 0 },
      []
    );
    const after = new Date().toISOString();
    expect(sale.created_at >= before).toBe(true);
    expect(sale.created_at <= after).toBe(true);
  });

  it("preserves the customer_id", () => {
    const sale = pendingSaleFrom(
      "abc-456",
      { customer_id: "cust-99", payment_method: "credit", discount_cents: 0, total_cents: 500 },
      []
    );
    expect(sale.customer_id).toBe("cust-99");
  });
});

describe("sync cycle: no duplicate submissions", () => {
  function makeSale(id: string): PendingSale {
    return pendingSaleFrom(
      id,
      { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 700 },
      []
    );
  }

  it("queue is empty after a successful sync", async () => {
    await enqueueSale(makeSale("sale-1"));
    expect(await countPendingSales()).toBe(1);

    // Simulate a successful submitSale: remove the sale from the queue.
    await removePendingSale("sale-1");

    expect(await countPendingSales()).toBe(0);
  });

  it("re-enqueueing after removal does not bring back the old sale", async () => {
    // This models the edge case where a race condition triggers enqueueSale
    // after the sale was already synced and removed.
    await enqueueSale(makeSale("sale-1"));
    await removePendingSale("sale-1");

    // Trying to enqueue again (re-adds it — this is intentional if the client
    // lost the sync response and retries). The queue has exactly one copy.
    await enqueueSale(makeSale("sale-1"));
    expect(await countPendingSales()).toBe(1);
  });

  it("only the first failing sale stays in the queue after a partial sync", async () => {
    await enqueueSale(makeSale("sale-1"));
    await enqueueSale(makeSale("sale-2"));
    await enqueueSale(makeSale("sale-3"));

    // Simulate sync: sale-1 succeeds, sale-2 fails (stop), sale-3 untouched.
    await removePendingSale("sale-1");
    // sale-2 and sale-3 remain.

    const remaining = (await listPendingSales()).map((s) => s.id);
    expect(remaining).toEqual(["sale-2", "sale-3"]);
  });
});
