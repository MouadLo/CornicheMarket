/**
 * The app side of voiding a delivery: one RPC call that carries the reason,
 * a read-only preview of what it will change, and the two reads that must
 * ignore a voided delivery (last price paid and price history), or a typo
 * that was just cancelled would pre-fill the next delivery.
 */
import {
  fetchLastPurchasePrice,
  fetchPriceHistory,
  fetchPurchase,
  previewVoidPurchase,
  voidPurchase,
} from "../../src/lib/stock/queries";

const mockRpc = jest.fn();
const mockCalls: { method: string; args: unknown[] }[] = [];
let mockResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };

// A chainable builder that records every call and resolves to mockResult.
function mockBuilder() {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, method: string) {
        if (method === "then") return (resolve: (v: unknown) => void) => resolve(mockResult);
        return (...args: unknown[]) => {
          mockCalls.push({ method, args });
          return proxy;
        };
      },
    }
  );
  return proxy;
}

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, payload: unknown) => mockRpc(fn, payload),
    from: (table: string) => {
      mockCalls.push({ method: "from", args: [table] });
      return mockBuilder();
    },
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockCalls.length = 0;
  mockResult = { data: null, error: null };
});

describe("voidPurchase", () => {
  it("sends the delivery and the trimmed reason in one RPC call", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    await voidPurchase("p1", "  quantity typo ");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("void_purchase", {
      p_purchase_id: "p1",
      p_reason: "quantity typo",
    });
  });

  it("refuses a blank reason before sending anything", async () => {
    await expect(voidPurchase("p1", "   ")).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("passes the server's refusal through", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Only the owner can void a delivery" },
    });

    await expect(voidPurchase("p1", "typo")).rejects.toThrow("Only the owner can void a delivery");
  });
});

describe("previewVoidPurchase", () => {
  it("maps the server rows to numbers", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          product_id: "a",
          product_name: "Coca-Cola 33cl",
          unit: "piece",
          quantity: "24.000",
          unit_cost_cents: 600,
          stock_before: "40.000",
          stock_after: "16.000",
          cost_before_cents: 555,
          cost_after_cents: 488,
        },
      ],
      error: null,
    });

    const rows = await previewVoidPurchase("p1");

    expect(mockRpc).toHaveBeenCalledWith("preview_void_purchase", { p_purchase_id: "p1" });
    expect(rows).toEqual([
      {
        productId: "a",
        productName: "Coca-Cola 33cl",
        unit: "piece",
        quantity: 24,
        unitCostCents: 600,
        stockBefore: 40,
        stockAfter: 16,
        costBeforeCents: 555,
        costAfterCents: 488,
      },
    ]);
  });

  it("throws on an error instead of returning an empty preview", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(previewVoidPurchase("p1")).rejects.toThrow("boom");
  });
});

describe("reads that must ignore a voided delivery", () => {
  it("last price paid skips lines of voided deliveries", async () => {
    mockResult = { data: { unit_cost_cents: 500 }, error: null };

    await expect(fetchLastPurchasePrice("prod")).resolves.toBe(500);

    const select = mockCalls.find((c) => c.method === "select");
    expect(String(select?.args[0])).toContain("purchases!inner");
    expect(mockCalls).toContainEqual({ method: "is", args: ["purchases.voided_at", null] });
  });

  it("price history skips lines of voided deliveries", async () => {
    mockResult = { data: [], error: null };

    await fetchPriceHistory("prod");

    const select = mockCalls.find((c) => c.method === "select");
    expect(String(select?.args[0])).toContain("purchases!inner");
    expect(mockCalls).toContainEqual({ method: "is", args: ["purchases.voided_at", null] });
  });
});

describe("fetchPurchase", () => {
  it("returns the header with its lines in the order they were received", async () => {
    mockResult = {
      data: {
        id: "p1",
        purchase_date: "2026-10-31T10:00:00Z",
        notes: "BL 12",
        voided_at: null,
        void_reason: null,
        suppliers: { name: "Atlas" },
        voider: null,
        purchase_items: [
          {
            id: "i2",
            quantity: "2.000",
            unit_cost_cents: 700,
            expiry_date: null,
            created_at: "2026-10-31T10:00:02Z",
            products: { name: "Lait", unit: "piece" },
          },
          {
            id: "i1",
            quantity: "24.000",
            unit_cost_cents: 600,
            expiry_date: "2027-01-01",
            created_at: "2026-10-31T10:00:01Z",
            products: { name: "Coca", unit: "piece" },
          },
        ],
      },
      error: null,
    };

    const purchase = await fetchPurchase("p1");

    expect(purchase.supplierName).toBe("Atlas");
    expect(purchase.voidedAt).toBeNull();
    expect(purchase.lines.map((l) => l.productName)).toEqual(["Coca", "Lait"]);
    expect(purchase.lines[0]).toMatchObject({
      quantity: 24,
      unitCostCents: 600,
      lineTotalCents: 14400,
      expiryDate: "2027-01-01",
    });
    expect(purchase.totalCents).toBe(14400 + 1400);
  });
});
