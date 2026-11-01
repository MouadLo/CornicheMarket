import {
  dismissReview,
  fetchAlertCounts,
  fetchReviewSales,
  reviewLinesFrom,
  totalAlerts,
  NO_ALERTS,
} from "../../src/lib/alerts/queries";

type Call = { table: string; filters: [string, unknown][]; head?: boolean };
const mockCalls: Call[] = [];
let mockTableData: Record<string, unknown> = {};
let mockCounts: Record<string, number> = {};
const mockRpc = jest.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  error: null as { message: string } | null,
}));

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      mockCalls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = (_cols: string, opts?: { head?: boolean }) => {
        call.head = opts?.head;
        return builder;
      };
      builder.eq = (col: string, value: unknown) => (call.filters.push([col, value]), builder);
      builder.in = (col: string, value: unknown) => (call.filters.push([col, value]), builder);
      builder.order = chain;
      builder.limit = chain;
      builder.then = (resolve: (v: unknown) => void) => {
        const key = call.filters.find(([c]) => c.startsWith("needs_"))?.[0] ?? table;
        resolve(
          call.head
            ? { count: mockCounts[key] ?? 0, error: null }
            : { data: mockTableData[table] ?? [], error: null }
        );
      };
      return builder;
    },
  },
}));

beforeEach(() => {
  mockCalls.length = 0;
  mockTableData = {};
  mockCounts = {};
  mockRpc.mockClear();
});

describe("alert mockCounts", () => {
  it("mockCounts flagged sales by kind, and negative-stock products", async () => {
    mockCounts = { needs_price_review: 3, needs_discount_review: 2, negative_stock_products: 1 };
    await expect(fetchAlertCounts()).resolves.toEqual({ price: 3, discount: 2, negativeStock: 1 });
    expect(mockCalls.map((c) => c.table).sort()).toEqual([
      "negative_stock_products",
      "sales",
      "sales",
    ]);
    expect(mockCalls.every((c) => c.head)).toBe(true);
  });

  it("totals alerts with the stuck sales that live on the device", () => {
    expect(totalAlerts({ price: 3, discount: 2, negativeStock: 1 }, 4)).toBe(10);
    expect(totalAlerts(NO_ALERTS, 0)).toBe(0);
  });
});

describe("review lines from the activity log", () => {
  it("price: device price, expected price, and whether it was the previous (stale) price", () => {
    expect(
      reviewLinesFrom("price", {
        lines: [
          {
            product_name: "Pain rond",
            device_price_cents: 100,
            expected_price_cents: 120,
            matches_previous_price: true,
          },
          {
            product_name: "Lait",
            device_price_cents: 1,
            expected_price_cents: 700,
            matches_previous_price: false,
          },
        ],
      })
    ).toEqual([
      { type: "price", name: "Pain rond", deviceCents: 100, expectedCents: 120, stale: true },
      { type: "price", name: "Lait", deviceCents: 1, expectedCents: 700, stale: false },
    ]);
  });

  it("discount: lines and the sale discount", () => {
    expect(
      reviewLinesFrom("discount", {
        lines: [{ product_name: "Thé", line_amount_cents: 2000, discount_cents: 500, percent: 25 }],
        sale_discount: { discount_cents: 451, basket_cents: 4500, percent: 10.02 },
      })
    ).toEqual([
      { type: "discount", name: "Thé", amountCents: 2000, discountCents: 500, percent: 25 },
      { type: "saleDiscount", amountCents: 4500, discountCents: 451, percent: 10.02 },
    ]);
  });

  it("tolerates a missing or empty log row", () => {
    expect(reviewLinesFrom("price", null)).toEqual([]);
    expect(reviewLinesFrom("discount", {})).toEqual([]);
  });
});

describe("review lists", () => {
  it("joins flagged sales with their log row and the cashier's name", async () => {
    mockTableData = {
      sales: [
        { id: "s1", occurred_at: "2026-11-01T10:00:00Z", total_cents: 300, cashier_id: "u1" },
      ],
      activity_log: [
        {
          entity_id: "s1",
          details: {
            lines: [
              {
                product_name: "Pain",
                device_price_cents: 100,
                expected_price_cents: 120,
                matches_previous_price: false,
              },
            ],
          },
        },
      ],
      profiles: [{ id: "u1", full_name: "Salma" }],
    };
    const items = await fetchReviewSales("price");
    expect(items).toEqual([
      {
        saleId: "s1",
        occurredAt: "2026-11-01T10:00:00Z",
        totalCents: 300,
        cashierName: "Salma",
        lines: [
          { type: "price", name: "Pain", deviceCents: 100, expectedCents: 120, stale: false },
        ],
      },
    ]);
    expect(mockCalls[0].filters).toContainEqual(["needs_price_review", true]);
    expect(mockCalls.find((c) => c.table === "activity_log")?.filters).toContainEqual([
      "action",
      "price_mismatch",
    ]);
  });

  it("asks for the discount flag and log action for discounts, and nothing more when the list is empty", async () => {
    mockTableData = { sales: [] };
    await expect(fetchReviewSales("discount")).resolves.toEqual([]);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].filters).toContainEqual(["needs_discount_review", true]);
  });
});

describe("dismissing a review", () => {
  it.each([
    ["price", "dismiss_price_review"],
    ["discount", "dismiss_discount_review"],
  ] as const)("%s goes through %s, never a direct update", async (kind, fn) => {
    await dismissReview(kind, "s1");
    expect(mockRpc).toHaveBeenCalledWith(fn, { p_sale_id: "s1" });
  });

  it("throws the server's error", async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: "Only the owner can review prices" } });
    await expect(dismissReview("price", "s1")).rejects.toThrow("Only the owner can review prices");
  });
});
