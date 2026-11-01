/**
 * Before this fix, submitSale's RPC payload carried no timestamp at all, so
 * every offline sale was stamped with the server's clock at SYNC time
 * (record_sale's created_at column default) rather than the time the sale
 * actually happened on the device. This test fails on the pre-fix payload:
 * it has no p_occurred_at key, so `payload.p_occurred_at` is undefined and
 * the first assertion below fails immediately.
 */
import { recordCustomerPayment, recoverSale, submitSale } from "../../src/lib/sales/queries";
import { pendingSaleFrom } from "../../src/lib/sales/useSaleSync";

// Prefixed with "mock" so Jest allows it inside the jest.mock() factory below.
const mockRpc = jest.fn(async (_fn: string, _payload: Record<string, unknown>) => ({
  data: null,
  error: null,
}));

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { rpc: (fn: string, payload: Record<string, unknown>) => mockRpc(fn, payload) },
}));

// pendingSaleFrom pulls in useSaleSync -> offlineQueue -> AsyncStorage, which
// throws outside a real RN runtime unless mocked.
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

// useSaleSync also imports NetInfo for its hook; not exercised here, but the
// module must resolve.
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

beforeEach(() => {
  mockRpc.mockClear();
});

describe("submitSale", () => {
  it("sends the device-captured sale time as p_occurred_at", async () => {
    const sale = pendingSaleFrom(
      "sale-1",
      { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 1000 },
      [],
      "user-1"
    );

    await submitSale(sale);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fn, payload] = mockRpc.mock.calls[0];
    expect(fn).toBe("record_sale");
    expect(payload.p_occurred_at).toBe(sale.created_at);
  });

  it("does not use the current time at submit time as the occurred_at value", async () => {
    const pastTime = "2020-01-01T00:00:00.000Z";
    const sale = {
      ...pendingSaleFrom(
        "sale-2",
        { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 500 },
        [],
        "user-1"
      ),
      created_at: pastTime,
    };

    await submitSale(sale);

    const [, payload] = mockRpc.mock.calls[0];
    expect(payload.p_occurred_at).toBe(pastTime);
    expect(payload.p_occurred_at).not.toBe(new Date().toISOString().slice(0, 10));
  });

  it("still sends every pre-existing parameter unchanged", async () => {
    const sale = pendingSaleFrom(
      "sale-3",
      { customer_id: "cust-1", payment_method: "credit", discount_cents: 200, total_cents: 1800 },
      [
        {
          product_id: "prod-1",
          name: "Lait",
          unit: "piece",
          quantity: 2,
          unit_price_cents: 1000,
          discount_cents: 0,
          unit_cost_cents: null,
        },
      ],
      "user-1"
    );

    await submitSale(sale);

    const [, payload] = mockRpc.mock.calls[0];
    expect(payload.p_sale_id).toBe("sale-3");
    expect(payload.p_customer_id).toBe("cust-1");
    expect(payload.p_payment_method).toBe("credit");
    expect(payload.p_discount_cents).toBe(200);
    expect(payload.p_lines).toEqual([
      { product_id: "prod-1", quantity: 2, unit_price_cents: 1000, discount_cents: 0 },
    ]);
  });
});

describe("recordCustomerPayment (audit C06 / C11)", () => {
  it("goes through record_customer_payment with the caller's retained id, never a direct insert", async () => {
    await recordCustomerPayment("pay-1", "cust-1", 2500, "cash");
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("record_customer_payment", {
      p_payment_id: "pay-1",
      p_customer_id: "cust-1",
      p_amount_cents: 2500,
      p_method: "cash",
    });
  });

  it("sends the same id on a retry, so the server records the money once", async () => {
    await recordCustomerPayment("pay-2", "cust-1", 2500, "cash");
    await recordCustomerPayment("pay-2", "cust-1", 2500, "cash");
    const ids = mockRpc.mock.calls.map(([, payload]) => payload.p_payment_id);
    expect(ids).toEqual(["pay-2", "pay-2"]);
  });

  it("throws the server's error so the screen keeps the payment open", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Payment ID conflicts" },
    } as never);
    await expect(recordCustomerPayment("pay-3", "cust-1", 1, "cash")).rejects.toThrow(
      "Payment ID conflicts"
    );
  });
});

describe("who a sale is credited to (audit C05)", () => {
  const base = {
    customer_id: null,
    payment_method: "cash",
    discount_cents: 0,
    total_cents: 100,
  } as const;

  it("submitSale sends the user who rang it up as an expected-cashier assertion, never as a claim", async () => {
    await submitSale(pendingSaleFrom("s1", base, [], "user-a"));
    const [fn, payload] = mockRpc.mock.calls[0];
    expect(fn).toBe("record_sale");
    expect(payload.p_expected_cashier).toBe("user-a");
    expect(payload).not.toHaveProperty("p_cashier_id");
  });

  it("a legacy sale has no expected cashier", async () => {
    const legacy = pendingSaleFrom("s2", base, [], "user-a");
    delete (legacy as { cashier_id?: string }).cashier_id;
    await submitSale(legacy);
    expect(mockRpc.mock.calls[0][1].p_expected_cashier).toBeNull();
  });

  it("recoverSale uses recover_sale, passes the original cashier for the log, and no expected cashier", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null } as never);
    await expect(recoverSale(pendingSaleFrom("s3", base, [], "user-a"))).resolves.toBe(true);
    const [fn, payload] = mockRpc.mock.calls[0];
    expect(fn).toBe("recover_sale");
    expect(payload.p_original_cashier_id).toBe("user-a");
    expect(payload).not.toHaveProperty("p_expected_cashier");
  });

  it("recoverSale of a legacy sale logs an unknown original cashier", async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null } as never);
    const legacy = pendingSaleFrom("s4", base, [], "user-a");
    delete (legacy as { cashier_id?: string }).cashier_id;
    await expect(recoverSale(legacy)).resolves.toBe(false);
    expect(mockRpc.mock.calls[0][1].p_original_cashier_id).toBeNull();
  });
});
