/**
 * Stock screens: a failed read is an error with Retry, never "nothing low" or
 * "no deliveries"; an empty list offers the owner the next step.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import AdjustScreen from "../../app/(app)/stock-in/adjust";
import ExpiringScreen from "../../app/(app)/stock-in/expiring";
import PurchaseHistory from "../../app/(app)/stock-in/history";
import InvoiceList from "../../app/(app)/stock-in/invoice/index";
import LowStockScreen from "../../app/(app)/stock-in/low-stock";
import NegativeStockScreen from "../../app/(app)/stock-in/negative-stock";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

let mockRole: "owner" | "cashier" = "owner";
const mockPush = jest.fn();
const mockPurchases = jest.fn();
const mockMonths = jest.fn();
const mockSuppliers = jest.fn();
const mockLow = jest.fn();
const mockVelocity = jest.fn();
const mockExpiring = jest.fn();
const mockNegative = jest.fn();
const mockRecentAdjustments = jest.fn();
const mockDrafts = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    React.useEffect(cb, [cb]);
  },
}));
jest.mock("react-i18next", () => {
  const t = (key: string) => key;
  const value = { t, i18n: { language: "fr" } };
  return { useTranslation: () => value };
});
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/files", () => ({ saveTextFile: jest.fn() }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: mockRole } }),
}));
jest.mock("../../src/lib/stock/queries", () => ({
  ...jest.requireActual("../../src/lib/stock/queries"),
  fetchPurchases: (...a: unknown[]) => mockPurchases(...a),
  fetchMonthlyTotals: (...a: unknown[]) => mockMonths(...a),
  fetchSupplierTotals: (...a: unknown[]) => mockSuppliers(...a),
}));
jest.mock("../../src/lib/inventory/queries", () => ({
  ...jest.requireActual("../../src/lib/inventory/queries"),
  fetchLowStockProducts: (...a: unknown[]) => mockLow(...a),
  fetchSalesVelocity: (...a: unknown[]) => mockVelocity(...a),
  fetchExpiringBatches: (...a: unknown[]) => mockExpiring(...a),
  fetchNegativeStockProducts: (...a: unknown[]) => mockNegative(...a),
  fetchRecentAdjustments: (...a: unknown[]) => mockRecentAdjustments(...a),
}));
jest.mock("../../src/lib/stock/invoices", () => ({
  ...jest.requireActual("../../src/lib/stock/invoices"),
  listInvoiceDrafts: (...a: unknown[]) => mockDrafts(...a),
}));

let tree: ReactTestRenderer;
const render = async (el: React.ReactElement) => {
  await act(async () => {
    tree = create(el);
  });
};
const texts = () => allTexts(tree.root);
const joined = () => texts().join("|");
const retry = () => act(async () => pressableByText(tree.root, "common.retry").props.onPress());
const offline = () => new TypeError("Failed to fetch");

beforeEach(() => {
  mockRole = "owner";
  [
    mockPush,
    mockPurchases,
    mockMonths,
    mockSuppliers,
    mockLow,
    mockVelocity,
    mockExpiring,
    mockNegative,
    mockRecentAdjustments,
    mockDrafts,
  ].forEach((m) => m.mockReset());
  mockMonths.mockResolvedValue([]);
  mockSuppliers.mockResolvedValue([]);
  mockVelocity.mockResolvedValue(new Map());
  mockRecentAdjustments.mockResolvedValue([]);
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined as never;
});

describe("delivery history", () => {
  it("a failed read is an error with Retry, not 'no deliveries'", async () => {
    mockPurchases.mockRejectedValue(offline());
    await render(<PurchaseHistory />);
    expect(texts()).toContain("stockIn.historyLoadError");
    expect(joined()).toContain("errors.offlineExplain");
    expect(texts()).not.toContain("stockIn.historyEmptyTitle");
    expect(joined()).not.toContain("Failed to fetch");
    mockPurchases.mockResolvedValue([]);
    await retry();
    expect(texts()).toContain("stockIn.historyEmptyTitle");
  });

  it("an empty history offers the owner 'receive a delivery'", async () => {
    mockPurchases.mockResolvedValue([]);
    await render(<PurchaseHistory />);
    await act(async () => pressableByText(tree.root, "stockIn.historyEmptyAction").props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/stock-in/receive");
  });

  it("a cashier is never offered it", async () => {
    mockRole = "cashier";
    mockPurchases.mockResolvedValue([]);
    await render(<PurchaseHistory />);
    expect(texts()).toContain("stockIn.historyEmptyTitle");
    expect(texts()).not.toContain("stockIn.historyEmptyAction");
  });
});

describe("low stock", () => {
  it("a failed read is not 'nothing is low on stock'", async () => {
    mockLow.mockRejectedValue(new Error("permission denied for table products"));
    await render(<LowStockScreen />);
    expect(texts()).toContain("stockIn.lowStockLoadError");
    expect(joined()).toContain("errors.permission");
    expect(joined()).not.toContain("permission denied");
    expect(texts()).not.toContain("stockIn.lowStockEmpty");
    mockLow.mockResolvedValue([]);
    await retry();
    expect(texts()).toContain("stockIn.lowStockEmpty");
  });
});

describe("negative stock", () => {
  it("a failed read is not 'no products in negative stock'", async () => {
    mockNegative.mockRejectedValue(offline());
    await render(<NegativeStockScreen />);
    expect(texts()).toContain("stockIn.negativeStockLoadError");
    expect(texts()).not.toContain("stockIn.negativeStockEmpty");
    mockNegative.mockResolvedValue([]);
    await retry();
    expect(texts()).toContain("stockIn.negativeStockEmpty");
  });
});

describe("expiring", () => {
  it("a failed read is not 'nothing expiring'", async () => {
    mockExpiring.mockRejectedValue(new Error("something odd"));
    await render(<ExpiringScreen />);
    expect(texts()).toContain("stockIn.expiringLoadError");
    expect(joined()).not.toContain("something odd");
    expect(joined()).not.toContain("stockIn.expiringNone");
    mockExpiring.mockResolvedValue([]);
    await retry();
    expect(joined()).toContain("stockIn.expiringNone");
  });
});

describe("recent adjustments", () => {
  it("a failed read is not 'no adjustments recorded'", async () => {
    mockRecentAdjustments.mockRejectedValue(offline());
    await render(<AdjustScreen />);
    expect(texts()).toContain("stockIn.adjustHistoryLoadError");
    expect(texts()).not.toContain("stockIn.adjustNone");
    mockRecentAdjustments.mockResolvedValue([]);
    await retry();
    expect(texts()).toContain("stockIn.adjustNone");
  });
});

describe("invoice drafts", () => {
  it("a failed read is not 'no invoice drafts'", async () => {
    mockDrafts.mockRejectedValue(offline());
    await render(<InvoiceList />);
    expect(texts()).toContain("invoices.loadError");
    expect(texts()).not.toContain("invoices.noDrafts");
    expect(texts().filter((x) => x === "common.retry")).toHaveLength(1);
    mockDrafts.mockResolvedValue([]);
    await retry();
    expect(texts()).toContain("invoices.noDrafts");
  });

  it("an empty list offers 'scan an invoice'", async () => {
    mockDrafts.mockResolvedValue([]);
    await render(<InvoiceList />);
    await act(async () => pressableByText(tree.root, "invoices.scan").props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/stock-in/invoice/capture");
  });

  it("a cashier gets no list and no action", async () => {
    mockRole = "cashier";
    await render(<InvoiceList />);
    expect(texts()).toContain("stockIn.blockedText");
    expect(texts()).not.toContain("invoices.scan");
    expect(mockDrafts).not.toHaveBeenCalled();
  });
});
