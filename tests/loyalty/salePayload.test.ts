// The loyalty part of the record_sale payload, and its journey through the
// offline queue: the same sale id and the same loyalty payload on every retry.
import {
  enqueueSale,
  listPendingSales,
  markAttempt,
  type PendingSale,
} from "../../src/lib/sales/offlineQueue";
import { recoverSale, submitSale } from "../../src/lib/sales/queries";
import { pendingSaleFrom, syncPendingSales } from "../../src/lib/sales/useSaleSync";

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
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

const mockRpc = jest.fn(
  async (
    _fn: string,
    _payload: Record<string, unknown>
  ): Promise<{
    data: unknown;
    error: { message: string } | null;
    status?: number;
  }> => ({ data: null, error: null })
);
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, payload: Record<string, unknown>) => mockRpc(fn, payload),
    auth: {
      refreshSession: jest.fn(async () => ({ error: null })),
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }),
    },
  },
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({ useAuth: () => ({ session: null }) }));

const payment = {
  customer_id: null,
  payment_method: "cash" as const,
  discount_cents: 0,
  total_cents: 1000,
};

beforeEach(() => {
  mockStore.clear();
  mockRpc.mockClear();
  mockRpc.mockImplementation(async () => ({ data: null, error: null }));
});

describe("record_sale payload", () => {
  it("a sale without a member has no p_loyalty at all (old payloads are unchanged)", async () => {
    await submitSale(pendingSaleFrom("sale-1", payment, [], "user-1"));
    const payload = mockRpc.mock.calls[0][1];
    expect(payload).not.toHaveProperty("p_loyalty");
    expect(Object.keys(payload).sort()).toEqual(
      [
        "p_sale_id",
        "p_customer_id",
        "p_payment_method",
        "p_discount_cents",
        "p_lines",
        "p_occurred_at",
        "p_expected_cashier",
      ].sort()
    );
  });

  it("a member's sale sends p_loyalty exactly as queued", async () => {
    const loyalty = {
      customer_id: "c1",
      redeem_points: 120,
      card_token: "A".repeat(22),
    };
    const sale = pendingSaleFrom(
      "sale-2",
      { ...payment, discount_cents: 1200, total_cents: 800, loyalty },
      [],
      "user-1"
    );
    await submitSale(sale);
    const payload = mockRpc.mock.calls[0][1];
    expect(payload.p_loyalty).toEqual(loyalty);
    expect(payload.p_discount_cents).toBe(1200);
  });

  it("an offline member is sent by phone", async () => {
    const sale = pendingSaleFrom(
      "sale-3",
      { ...payment, loyalty: { phone: "+212612345678" } },
      [],
      "user-1"
    );
    await submitSale(sale);
    expect(mockRpc.mock.calls[0][1].p_loyalty).toEqual({ phone: "+212612345678" });
  });

  it("recovery has no p_loyalty argument: recover_sale does not take one", async () => {
    const sale = pendingSaleFrom(
      "sale-4",
      { ...payment, loyalty: { customer_id: "c1" } },
      [],
      "user-1"
    );
    await recoverSale(sale);
    const [fn, payload] = mockRpc.mock.calls[0];
    expect(fn).toBe("recover_sale");
    expect(payload).not.toHaveProperty("p_loyalty");
  });
});

describe("loyalty through the offline queue", () => {
  const loyaltySale = (): PendingSale =>
    pendingSaleFrom(
      "sale-5",
      {
        ...payment,
        discount_cents: 1000,
        total_cents: 500,
        loyalty: { customer_id: "c1", redeem_points: 100, card_token: "B".repeat(22) },
      },
      [],
      "user-1"
    );

  it("is stored and read back unchanged", async () => {
    await enqueueSale(loyaltySale());
    const [stored] = await listPendingSales();
    expect(stored.loyalty).toEqual({
      customer_id: "c1",
      redeem_points: 100,
      card_token: "B".repeat(22),
    });
  });

  it("a sale queued before loyalty existed is read as it was, with no loyalty key", async () => {
    const old = pendingSaleFrom("old", payment, [], "user-1");
    await enqueueSale(old);
    const [stored] = await listPendingSales();
    expect(stored).not.toHaveProperty("loyalty");
  });

  it("a sale whose loyalty block is garbage is set aside, not sent", async () => {
    await enqueueSale(loyaltySale());
    const raw = JSON.parse(mockStore.get("corniche.pendingSales.v1") as string);
    raw[0].loyalty = { redeem_points: -5 };
    mockStore.set("corniche.pendingSales.v1", JSON.stringify(raw));
    expect(await listPendingSales()).toEqual([]);
    expect(mockStore.get("corniche.unreadableSales.v1")).toContain("sale-5");
  });

  it("a failed attempt re-sends the same id and the same loyalty payload", async () => {
    await enqueueSale(loyaltySale());
    mockRpc.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "Failed to fetch" },
    }));
    await syncPendingSales("user-1");
    // Still queued after a temporary failure.
    expect(await listPendingSales()).toHaveLength(1);
    await markAttempt("sale-5", "Failed to fetch");

    await syncPendingSales("user-1");
    expect(await listPendingSales()).toHaveLength(0);

    const [first, second] = mockRpc.mock.calls.map(([, payload]) => payload);
    expect(second.p_sale_id).toBe(first.p_sale_id);
    expect(second.p_loyalty).toEqual(first.p_loyalty);
    expect(second.p_loyalty).toEqual({
      customer_id: "c1",
      redeem_points: 100,
      card_token: "B".repeat(22),
    });
    expect(second.p_discount_cents).toBe(first.p_discount_cents);
  });
});
