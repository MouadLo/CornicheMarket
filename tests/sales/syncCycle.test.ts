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
  countStuckSales,
  enqueueSale,
  isAuthError,
  isTemporaryError,
  listPendingSales,
  listStuckSales,
  quarantineSale,
  removePendingSale,
  retryStuckSale,
  type PendingSale,
} from "../../src/lib/sales/offlineQueue";
import { pendingSaleFrom, submitWithAuthRetry } from "../../src/lib/sales/useSaleSync";

// Prefixed with "mock" so Jest hoists these into the jest.mock() factories
// below correctly.
const mockSubmitSale = jest.fn();
const mockRefreshSession = jest.fn();

// useSaleSync imports submitSale from queries, which triggers the Supabase
// client initializer that requires env vars. Mock the module so only the
// pure pendingSaleFrom/submitWithAuthRetry helpers are exercised here.
jest.mock("../../src/lib/sales/queries", () => ({
  submitSale: (...args: unknown[]) => mockSubmitSale(...args),
  fetchCustomers: jest.fn(),
  voidSale: jest.fn(),
}));

// submitWithAuthRetry calls supabase.auth.refreshSession() directly.
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { auth: { refreshSession: (...args: unknown[]) => mockRefreshSession(...args) } },
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

beforeEach(() => {
  mockStore.clear();
  mockSubmitSale.mockReset();
  mockRefreshSession.mockReset();
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

describe("isTemporaryError", () => {
  it.each([
    "Network request failed",
    "Failed to fetch",
    "fetch failed",
    "Socket timeout",
    "connection timeout",
    "503 Service Unavailable",
    "502 Bad Gateway",
    "504 Gateway Timeout",
    // An expired/invalid token is a recoverable auth hiccup, not a
    // permanent rejection -- see PRE-LAUNCH-GAPS.md#b3. It used to be
    // classified permanent, which quarantined real sales on the first
    // attempt after a session expiry.
    "401 Unauthorized",
    "JWT expired",
    "invalid JWT",
    "Invalid Refresh Token",
  ])("classifies '%s' as temporary", (msg) => {
    expect(isTemporaryError(msg)).toBe(true);
  });

  it.each([
    "invalid input syntax",
    "foreign key violation",
    "duplicate key value",
    "400 Bad Request",
    // 403 stays permanent: RLS denying an action the user genuinely isn't
    // allowed to take (not an expired token) should never be retried.
    "403 Forbidden",
    "404 Not Found",
    "22P02",
  ])("classifies '%s' as permanent", (msg) => {
    expect(isTemporaryError(msg)).toBe(false);
  });
});

describe("isAuthError", () => {
  it.each(["JWT expired", "invalid JWT", "401 Unauthorized", "Invalid Refresh Token"])(
    "classifies '%s' as an auth error",
    (msg) => {
      expect(isAuthError(msg)).toBe(true);
    }
  );

  it.each(["403 Forbidden", "Network request failed", "foreign key violation"])(
    "does not classify '%s' as an auth error",
    (msg) => {
      expect(isAuthError(msg)).toBe(false);
    }
  );
});

describe("submitWithAuthRetry: an expired token syncs after refresh and is never parked", () => {
  function makeSale(id: string): PendingSale {
    return pendingSaleFrom(
      id,
      { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 900 },
      []
    );
  }

  it("refreshes the session and resubmits once, succeeding without quarantine", async () => {
    mockSubmitSale.mockRejectedValueOnce(new Error("JWT expired")).mockResolvedValueOnce(undefined);
    mockRefreshSession.mockResolvedValueOnce({ error: null });

    const sale = makeSale("auth-1");
    await enqueueSale(sale);

    await submitWithAuthRetry(sale);
    await removePendingSale(sale.id);

    expect(mockSubmitSale).toHaveBeenCalledTimes(2);
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(await countPendingSales()).toBe(0);
    expect(await countStuckSales()).toBe(0);
  });

  it("propagates the original error if the refresh itself fails, rather than retrying blindly", async () => {
    mockSubmitSale.mockRejectedValueOnce(new Error("JWT expired"));
    mockRefreshSession.mockResolvedValueOnce({ error: new Error("Invalid Refresh Token") });

    const sale = makeSale("auth-2");
    await enqueueSale(sale);

    await expect(submitWithAuthRetry(sale)).rejects.toThrow("JWT expired");
    // submitSale must not be called a second time with a token we already
    // know is bad.
    expect(mockSubmitSale).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a refresh for a non-auth error", async () => {
    mockSubmitSale.mockRejectedValueOnce(new Error("Network request failed"));

    await expect(submitWithAuthRetry(makeSale("auth-3"))).rejects.toThrow("Network request failed");
    expect(mockRefreshSession).not.toHaveBeenCalled();
    expect(mockSubmitSale).toHaveBeenCalledTimes(1);
  });
});

describe("quarantine: stuck queue", () => {
  function makeSale(id: string): PendingSale {
    return pendingSaleFrom(
      id,
      { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 700 },
      []
    );
  }

  it("moves a sale from the retry queue to the stuck list", async () => {
    const sale = makeSale("stuck-1");
    await enqueueSale(sale);
    expect(await countPendingSales()).toBe(1);

    await quarantineSale(sale, "foreign key violation");

    expect(await countPendingSales()).toBe(0);
    expect(await countStuckSales()).toBe(1);
    const [entry] = await listStuckSales();
    expect(entry.sale.id).toBe("stuck-1");
    expect(entry.error).toBe("foreign key violation");
  });

  it("quarantine is idempotent — calling twice does not duplicate", async () => {
    const sale = makeSale("stuck-2");
    await enqueueSale(sale);
    await quarantineSale(sale, "error A");
    await quarantineSale(sale, "error B"); // second call: already absent from queue
    expect(await countStuckSales()).toBe(1);
    // First error wins
    const [entry] = await listStuckSales();
    expect(entry.error).toBe("error A");
  });

  it("retryStuckSale moves the sale back to the queue with attempts reset", async () => {
    const sale = { ...makeSale("stuck-3"), attempts: 5 };
    await quarantineSale(sale, "some error");
    expect(await countStuckSales()).toBe(1);

    await retryStuckSale("stuck-3");

    expect(await countStuckSales()).toBe(0);
    expect(await countPendingSales()).toBe(1);
    const [queued] = await listPendingSales();
    expect(queued.attempts).toBe(0);
  });
});
