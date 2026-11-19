import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SalesHistory from "../../app/(app)/sell/history";
import { ReceiptPanel } from "../../src/components/sell/ReceiptPanel";
import { allTexts, pressableByText } from "./sellTestUtils";

const mockFetchRecent = jest.fn();
const mockFetchLines = jest.fn();
let mockRole: "owner" | "cashier" = "owner";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: "fr" },
  }),
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
  supabase: { rpc: async () => ({ data: "UTC", error: null }) },
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

const sale = (id: string, extra: object = {}) => ({
  id,
  created_at: "2026-11-17T10:00:00Z",
  occurred_at: "2026-11-17T10:00:00Z",
  payment_method: "cash",
  total_cents: 1150,
  discount_cents: 0,
  customer_id: null,
  cashier_id: "u-1",
  voided_at: null,
  void_reason: null,
  ...extra,
});
const line = (saleId: string) => ({
  id: `l-${saleId}`,
  sale_id: saleId,
  product_name: "Huile",
  unit: "piece",
  quantity: 2,
  unit_price_cents: 600,
  discount_cents: 50,
  line_total_cents: 1150,
});

let tree: ReactTestRenderer;
beforeEach(() => {
  mockRole = "owner";
  mockFetchRecent.mockResolvedValue([
    sale("aaaaaaaa-1"),
    sale("bbbbbbbb-2", { voided_at: "2026-11-17T11:00:00Z", void_reason: "x" }),
  ]);
  mockFetchLines.mockResolvedValue([line("aaaaaaaa-1"), line("bbbbbbbb-2")]);
});
afterEach(() => {
  act(() => tree.unmount());
});

const openRows = () =>
  tree.root.findAll(
    (n) =>
      (n.props.accessibilityLabel === "sell.historyOpen" ||
        n.props.accessibilityLabel === "sell.historyClose") &&
      typeof n.props.onPress === "function" &&
      // The composite and its host node carry the same props: count the row once.
      n.parent?.props.onPress !== n.props.onPress
  );

async function render() {
  await act(async () => {
    tree = create(<SalesHistory />);
  });
}
// Only one sale is open at a time.
const open = (index: number) => act(async () => openRows()[index].props.onPress());
const receiptActions = () => allTexts(tree.root).filter((x) => x === "receipt.action").length;

describe("receipt action in the sales history", () => {
  it.each(["owner", "cashier"] as const)(
    "is offered on a non-voided sale for the %s, not on a voided one",
    async (role) => {
      mockRole = role;
      await render();
      await open(0);
      expect(receiptActions()).toBe(1);
      await open(0); // close it
      await open(1);
      // The voided sale shows its lines but no receipt action.
      expect(allTexts(tree.root).filter((x) => x === "Huile")).toHaveLength(1);
      expect(receiptActions()).toBe(0);
      expect(mockFetchLines).toHaveBeenCalledWith(["aaaaaaaa-1", "bbbbbbbb-2"], role === "owner");
    }
  );

  it("opens the receipt of that sale with stored amounts and no cash details", async () => {
    await render();
    await open(0);
    await act(async () => pressableByText(tree.root, "receipt.action").props.onPress());
    const model = tree.root.findByType(ReceiptPanel).props.receipt;
    expect(model.receiptNumber).toBe("AAAAAAAA");
    expect(model.totalCents).toBe(1150);
    expect(model.lines[0].totalCents).toBe(1150);
    expect(model.cashReceivedCents).toBeNull();
    expect(model.changeCents).toBeNull();
    expect(JSON.stringify(model)).not.toMatch(/cost/i);
  });

  it("is not offered before the sale is opened", async () => {
    await act(async () => {
      tree = create(<SalesHistory />);
    });
    expect(allTexts(tree.root)).not.toContain("receipt.action");
  });
});
