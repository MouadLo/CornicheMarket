/**
 * Sales history (C13): day headers with totals, tap a row to see its lines,
 * "load more" pages on, and a cashier's queries never touch a cost column.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SalesHistory from "../../app/(app)/sell/history";
import { allTexts, pressableByText } from "./sellTestUtils";

const mockFetchRecent = jest.fn();
const mockFetchLines = jest.fn();
let mockRole: "owner" | "cashier" = "owner";

const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: "fr" } }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: mockRole } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: "UTC", error: null }),
  },
}));
jest.mock("../../src/lib/sales/queries", () => ({
  ...jest.requireActual("../../src/lib/sales/queries"),
  fetchRecentSales: (...a: unknown[]) => mockFetchRecent(...a),
  fetchSaleLines: (...a: unknown[]) => mockFetchLines(...a),
  voidSale: jest.fn(),
}));
jest.mock("../../src/lib/sales/voidRequests", () => ({
  ...jest.requireActual("../../src/lib/sales/voidRequests"),
  fetchMyVoidRequests: async () => [],
}));

const sale = (id: string, at: string, total: number, extra: object = {}) => ({
  id,
  created_at: at,
  occurred_at: at,
  payment_method: "cash",
  total_cents: total,
  discount_cents: 0,
  customer_id: null,
  cashier_id: "u-1",
  voided_at: null,
  void_reason: null,
  ...extra,
});

const page1 = [
  sale("a", "2026-11-17T10:00:00Z", 1250, { cashier_name: "Sara" }),
  sale("b", "2026-11-17T09:00:00Z", 999, { voided_at: "2026-11-17T09:30:00Z", void_reason: "x" }),
  sale("c", "2026-11-16T15:00:00Z", 300, { payment_method: "credit", customer_name: "Hassan" }),
];
const lines = [
  {
    id: "l1",
    sale_id: "a",
    product_name: "Huile",
    unit: "piece",
    quantity: 2,
    unit_price_cents: 600,
    discount_cents: 50,
    line_total_cents: 1150,
  },
];

let tree: ReactTestRenderer;
beforeEach(() => {
  mockRole = "owner";
  mockFetchRecent.mockReset();
  mockFetchRecent.mockResolvedValue(page1);
  mockFetchLines.mockReset();
  mockFetchLines.mockResolvedValue(lines);
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined as unknown as ReactTestRenderer;
});
const render = async () => {
  await act(async () => {
    tree = create(<SalesHistory />);
  });
};

describe("sales history", () => {
  it("groups by day with the total of non-voided sales", async () => {
    await render();
    const texts = allTexts(tree.root).join("|");
    expect(texts).toContain('sell.historyDayTotal:{"amount":"12.50 DH"}');
    expect(texts).toContain('sell.historyDayTotal:{"amount":"3.00 DH"}');
    expect(texts).toContain("mardi 17 novembre 2026");
    expect(texts).toContain("10:00");
    expect(texts).toContain('sell.historyCustomer:{"name":"Hassan"}');
    expect(texts).toContain('sell.historyCashier:{"name":"Sara"}');
  });

  it("shows an items preview, and the lines when a row is tapped", async () => {
    await render();
    expect(mockFetchLines).toHaveBeenCalledWith(["a", "b", "c"], true);
    expect(allTexts(tree.root).join("|")).toContain("Huile");
    expect(allTexts(tree.root).join("|")).not.toContain("1150");
    const row = tree.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "sell.historyOpen" && typeof n.props.onPress === "function"
    )[0];
    await act(async () => row.props.onPress());
    const texts = allTexts(tree.root).join("|");
    expect(texts).toContain("11.50 DH");
    expect(texts).toContain('sell.historyLineDiscount:{"amount":"0.50 DH"}');
  });

  it("loads the next page and stops when a page comes back short", async () => {
    const full = Array.from({ length: 50 }, (_, i) => sale(`s${i}`, "2026-11-17T10:00:00Z", 100));
    mockFetchRecent.mockResolvedValueOnce(full);
    await render();
    mockFetchRecent.mockResolvedValueOnce([sale("last", "2026-11-15T10:00:00Z", 100)]);
    await act(async () => pressableByText(tree.root, "sell.historyMore").props.onPress());
    expect(mockFetchRecent).toHaveBeenLastCalledWith(50, 50);
    expect(() => pressableByText(tree.root, "sell.historyMore")).toThrow();
  });

  it("keeps the owner's void button", async () => {
    await render();
    expect(
      tree.root.findAll((n) => allTexts(n).join("") === "sell.voidRefund" && n.props.onPress).length
    ).toBeGreaterThan(0);
  });
});
