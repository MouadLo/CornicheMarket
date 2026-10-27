/**
 * Before this fix, submitSale's RPC payload carried no timestamp at all, so
 * every offline sale was stamped with the server's clock at SYNC time
 * (record_sale's created_at column default) rather than the time the sale
 * actually happened on the device. This test fails on the pre-fix payload:
 * it has no p_occurred_at key, so `payload.p_occurred_at` is undefined and
 * the first assertion below fails immediately.
 */
import { submitSale } from "../../src/lib/sales/queries";
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
      []
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
        []
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
      ]
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
