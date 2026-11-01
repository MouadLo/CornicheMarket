/**
 * Audit C05: a sale queued offline was credited to whoever was signed in when
 * it synced, not to whoever rang it up. record_sale sets the cashier from the
 * caller's session (correct, and the server never trusts a client-supplied id),
 * so the fix is on the device: every queued sale carries the user it was rung
 * up under, and only that user's own session may send it.
 *
 *   A queues a sale offline, signs out, B signs in -> B's sync must not send it;
 *   A signs back in -> it is sent under A's session and credited to A.
 *
 * Legacy sales (queued before this fix, no user id) are never sent
 * automatically, by anyone: only the owner can recover them.
 *
 * T01's guarantees stay: serialized storage, no loss, the same sale id on retry.
 */
import {
  countPendingFor,
  enqueueSale,
  listPendingSales,
  listSalesOfOthers,
  listStuckSales,
  partitionByOwner,
  quarantineSale,
  type PendingSale,
} from "../../src/lib/sales/offlineQueue";
import {
  WrongSessionError,
  isWrongSessionError,
  pendingSaleFrom,
  submitWithAuthRetry,
  syncPendingSales,
} from "../../src/lib/sales/useSaleSync";

const mockSubmitSale = jest.fn();
const mockRefreshSession = jest.fn();
const mockGetSession = jest.fn();

jest.mock("../../src/lib/sales/queries", () => ({
  submitSale: (...args: unknown[]) => mockSubmitSale(...args),
  fetchCustomers: jest.fn(),
  voidSale: jest.fn(),
}));
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
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

const A = "user-a";
const B = "user-b";
const OWNER = "user-owner";

function sale(id: string, cashierId: string | undefined): PendingSale {
  const built = pendingSaleFrom(
    id,
    { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 1000 },
    [],
    cashierId as string
  );
  if (cashierId === undefined) delete (built as Partial<PendingSale>).cashier_id;
  return built;
}
const signedInAs = (userId: string | null) =>
  mockGetSession.mockResolvedValue({ data: { session: userId ? { user: { id: userId } } : null } });

beforeEach(() => {
  mockStore.clear();
  mockSubmitSale.mockReset();
  mockRefreshSession.mockReset();
  mockGetSession.mockReset();
  mockSubmitSale.mockResolvedValue(undefined);
  signedInAs(A);
});

describe("the queue records who rang the sale up", () => {
  it("pendingSaleFrom stamps the user id it is given", () => {
    expect(sale("s1", A).cashier_id).toBe(A);
  });

  it("the stamp survives storage", async () => {
    await enqueueSale(sale("s1", A));
    expect((await listPendingSales())[0].cashier_id).toBe(A);
  });

  it("refuses a sale whose user id is not a string", async () => {
    const bad = { ...sale("s1", A), cashier_id: 42 } as unknown as PendingSale;
    await expect(enqueueSale(bad)).rejects.toThrow(/Invalid pending sale/);
    expect(await listPendingSales()).toEqual([]);
  });

  it("still reads legacy sales that have no user id (nothing is lost on upgrade)", async () => {
    await enqueueSale(sale("old", undefined));
    const queue = await listPendingSales();
    expect(queue.map((s) => s.id)).toEqual(["old"]);
    expect(queue[0].cashier_id).toBeUndefined();
  });
});

describe("who owns what", () => {
  it("partitions a queue into mine, other users' and legacy", () => {
    const queue = [sale("a1", A), sale("b1", B), sale("old", undefined), sale("a2", A)];
    const parts = partitionByOwner(queue, A);
    expect(parts.mine.map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(parts.others.map((s) => s.id)).toEqual(["b1"]);
    expect(parts.legacy.map((s) => s.id)).toEqual(["old"]);
  });

  it("nobody owns anything when no one is signed in", () => {
    const parts = partitionByOwner([sale("a1", A), sale("old", undefined)], null);
    expect(parts.mine).toEqual([]);
    expect(parts.others.map((s) => s.id)).toEqual(["a1"]);
    expect(parts.legacy.map((s) => s.id)).toEqual(["old"]);
  });

  it("counts and lists per user", async () => {
    await enqueueSale(sale("a1", A));
    await enqueueSale(sale("b1", B));
    await enqueueSale(sale("old", undefined));
    expect(await countPendingFor(A)).toBe(1);
    expect(await countPendingFor(B)).toBe(1);
    expect(await countPendingFor(null)).toBe(0);
    expect((await listSalesOfOthers(A)).map((s) => s.id).sort()).toEqual(["b1", "old"]);
  });
});

describe("A queues offline, A signs out, B signs in (the audit's failure sequence)", () => {
  it("B's sync does not send A's sale, and does not touch it", async () => {
    await enqueueSale(sale("a-sale", A));
    const before = JSON.stringify(await listPendingSales());

    signedInAs(B);
    await syncPendingSales(B);

    expect(mockSubmitSale).not.toHaveBeenCalled();
    expect(JSON.stringify(await listPendingSales())).toBe(before); // not even an attempt counted
  });

  it("when A signs back in, the sale is sent under A's session with the same id, once", async () => {
    await enqueueSale(sale("a-sale", A));
    signedInAs(B);
    await syncPendingSales(B);

    signedInAs(A);
    await syncPendingSales(A);

    expect(mockSubmitSale).toHaveBeenCalledTimes(1);
    expect(mockSubmitSale.mock.calls[0][0]).toMatchObject({ id: "a-sale", cashier_id: A });
    expect(await listPendingSales()).toEqual([]);
  });

  it("a mixed queue: each user's sync sends only their own, in order, and leaves the rest", async () => {
    for (const [id, who] of [
      ["a1", A],
      ["b1", B],
      ["a2", A],
      ["b2", B],
    ] as const) {
      await enqueueSale(sale(id, who));
    }
    signedInAs(B);
    await syncPendingSales(B);
    expect(mockSubmitSale.mock.calls.map(([s]) => s.id)).toEqual(["b1", "b2"]);
    expect((await listPendingSales()).map((s) => s.id)).toEqual(["a1", "a2"]);

    mockSubmitSale.mockClear();
    signedInAs(A);
    await syncPendingSales(A);
    expect(mockSubmitSale.mock.calls.map(([s]) => s.id)).toEqual(["a1", "a2"]);
    expect(await listPendingSales()).toEqual([]);
  });

  it("nobody signed in sends nothing", async () => {
    await enqueueSale(sale("a-sale", A));
    signedInAs(null);
    await syncPendingSales(null);
    expect(mockSubmitSale).not.toHaveBeenCalled();
    expect(await listPendingSales()).toHaveLength(1);
  });

  it("the owner signing in does not send a cashier's sale either (the audit's 'attributed to an owner')", async () => {
    await enqueueSale(sale("a-sale", A));
    signedInAs(OWNER);
    await syncPendingSales(OWNER);
    expect(mockSubmitSale).not.toHaveBeenCalled();
  });

  it("a failing sale of B's does not block or alter A's sale", async () => {
    await enqueueSale(sale("b1", B));
    await enqueueSale(sale("a1", A));
    mockSubmitSale.mockRejectedValue(new Error("Failed to fetch"));
    signedInAs(B);
    await syncPendingSales(B);
    const queue = await listPendingSales();
    expect(queue.find((s) => s.id === "a1")?.attempts).toBe(0);
    expect(queue.find((s) => s.id === "b1")?.attempts).toBe(1);
  });
});

describe("legacy sales (queued before this fix)", () => {
  it("are never sent automatically by anyone, so they cannot be credited to the wrong user", async () => {
    await enqueueSale(sale("old", undefined));
    for (const who of [A, B, OWNER]) {
      signedInAs(who);
      await syncPendingSales(who);
    }
    expect(mockSubmitSale).not.toHaveBeenCalled();
    expect((await listPendingSales()).map((s) => s.id)).toEqual(["old"]);
  });

  it("stay listed as other users' sales, ready for the owner to recover", async () => {
    await enqueueSale(sale("old", undefined));
    expect((await listSalesOfOthers(OWNER)).map((s) => s.id)).toEqual(["old"]);
  });
});

describe("the session changes while a sale is being sent", () => {
  it("a sale is not sent if the session is no longer its user's", async () => {
    signedInAs(B);
    await expect(submitWithAuthRetry(sale("a-sale", A))).rejects.toBeInstanceOf(WrongSessionError);
    expect(mockSubmitSale).not.toHaveBeenCalled();
  });

  it("after an expired-token refresh, the retry is not sent under a different user", async () => {
    signedInAs(A);
    mockSubmitSale.mockRejectedValueOnce(new Error("JWT expired"));
    // The refresh happens while B has signed in.
    mockRefreshSession.mockImplementation(async () => {
      signedInAs(B);
      return { error: null };
    });
    await expect(submitWithAuthRetry(sale("a-sale", A))).rejects.toBeInstanceOf(WrongSessionError);
    expect(mockSubmitSale).toHaveBeenCalledTimes(1);
  });

  it("a wrong-session failure leaves the sale queued, untouched: no attempt, no quarantine", async () => {
    await enqueueSale(sale("a-sale", A));
    mockSubmitSale.mockRejectedValue(new WrongSessionError());
    await syncPendingSales(A);
    const [kept] = await listPendingSales();
    expect(kept).toMatchObject({ id: "a-sale", attempts: 0 });
  });

  it("recognises the server's refusal too (record_sale's expected-cashier guard)", () => {
    expect(isWrongSessionError("This sale was rung up by another user")).toBe(true);
    expect(isWrongSessionError("Failed to fetch")).toBe(false);
  });
});

describe("a run for one user does not swallow another user's request", () => {
  it("B's sync request while A's run is in flight is sent after it, for B", async () => {
    await enqueueSale(sale("a1", A));
    await enqueueSale(sale("b1", B));
    let release!: () => void;
    mockSubmitSale
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(undefined);

    const forA = syncPendingSales(A);
    await new Promise((r) => setTimeout(r, 0));
    signedInAs(B);
    const forB = syncPendingSales(B);
    release();
    await Promise.all([forA, forB]);

    expect(mockSubmitSale.mock.calls.map(([s]) => s.id)).toEqual(["a1", "b1"]);
    expect(await listPendingSales()).toEqual([]);
  });

  it("two requests for the same user still share one run", async () => {
    await enqueueSale(sale("a1", A));
    const first = syncPendingSales(A);
    const second = syncPendingSales(A);
    expect(second).toBe(first);
    await first;
    expect(mockSubmitSale).toHaveBeenCalledTimes(1);
  });
});

describe("T01 is intact", () => {
  it("a retried sale keeps the same id, the same user and the same lines", async () => {
    await enqueueSale(sale("a-sale", A));
    mockSubmitSale.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(undefined);
    await syncPendingSales(A);
    await syncPendingSales(A);
    const ids = mockSubmitSale.mock.calls.map(([s]) => [s.id, s.cashier_id]);
    expect(ids).toEqual([
      ["a-sale", A],
      ["a-sale", A],
    ]);
    expect(await listPendingSales()).toEqual([]);
  });

  it("a quarantined sale keeps its user id", async () => {
    const s = sale("a-sale", A);
    await enqueueSale(s);
    await quarantineSale(s, "rejected");
    expect((await listStuckSales())[0].sale.cashier_id).toBe(A);
  });
});
