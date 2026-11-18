/**
 * Clients list (search, one colour for money owed) and a customer's history
 * (timeline, voided marked and not counted, lines through the cashier view).
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { StyleSheet, TextInput } from "react-native";

import CreditScreen from "../../app/(app)/clients/index";
import CustomerHistory from "../../app/(app)/clients/[id]";
import { allTexts, pressableByText, textOf } from "./sellTestUtils";

let mockRole: "owner" | "cashier" = "owner";
const mockBalances = jest.fn();
const mockBalance = jest.fn();
const mockSales = jest.fn();
const mockPayments = jest.fn();
const mockLines = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-crypto", () => ({ randomUUID: () => "pay-1" }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({ id: "c1" }),
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    React.useEffect(cb, [cb]);
  },
}));
jest.mock("react-i18next", () => {
  // A stable t, like the real one: screens reload when t changes.
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key);
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
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: mockRole } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: "UTC", error: null }) },
}));
jest.mock("../../src/lib/sales/queries", () => ({
  ...jest.requireActual("../../src/lib/sales/queries"),
  fetchCustomerBalances: (...a: unknown[]) => mockBalances(...a),
  fetchCustomerBalance: (...a: unknown[]) => mockBalance(...a),
  fetchCustomerCreditSales: (...a: unknown[]) => mockSales(...a),
  fetchCustomerPayments: (...a: unknown[]) => mockPayments(...a),
  fetchSaleLines: (...a: unknown[]) => mockLines(...a),
  recordCustomerPayment: jest.fn(),
}));

const bal = (id: string, name: string, balance: number, phone: string | null = null) => ({
  id,
  name,
  phone,
  credit_total_cents: Math.max(balance, 0),
  paid_total_cents: 0,
  balance_cents: balance,
});

let tree: ReactTestRenderer;
const render = async (el: React.ReactElement) => {
  await act(async () => {
    tree = create(el);
  });
};
beforeEach(() => {
  mockRole = "owner";
  [mockBalances, mockBalance, mockSales, mockPayments, mockLines, mockPush].forEach((m) =>
    m.mockReset()
  );
});
afterEach(() => act(() => tree.unmount()));

describe("clients list", () => {
  beforeEach(() => {
    mockBalances.mockResolvedValue([
      bal("c1", "Hélène", 1000, "0661 23 45 67"),
      bal("c2", "Omar", 500),
      bal("c3", "Sara", -200),
    ]);
  });

  it("filters by name or phone, shows a no-result message, keeps the total unfiltered", async () => {
    await render(<CreditScreen />);
    const input = () => tree.root.findByType(TextInput);
    await act(async () => input().props.onChangeText("helene"));
    let texts = allTexts(tree.root).join("|");
    expect(texts).toContain("Hélène");
    expect(texts).not.toContain("Omar");
    expect(texts).toContain("15.00 DH");
    await act(async () => input().props.onChangeText("0661"));
    expect(allTexts(tree.root).join("|")).toContain("Hélène");
    await act(async () => input().props.onChangeText("zzz"));
    expect(allTexts(tree.root)).toContain("credit.noResults");
  });

  it("opens a customer's history, settled and in-credit customers included", async () => {
    await render(<CreditScreen />);
    const sara = tree.root.find(
      (n) =>
        n.props.accessibilityLabel === 'credit.openCustomer{"name":"Sara"}' &&
        typeof n.props.onPress === "function"
    );
    await act(async () => sara.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/clients/[id]",
      params: { id: "c3" },
    });
    expect(allTexts(tree.root).join("|")).toContain("credit.inCredit");
  });

  it("paints the total owed in the same colour as each debt", async () => {
    await render(<CreditScreen />);
    const colorOf = (text: string) =>
      StyleSheet.flatten(
        tree.root.find((n) => (n.type as unknown) === "Text" && n.props.children === text).props
          .style
      ).color;
    expect(colorOf("\u206615.00 DH\u2069")).toBe(colorOf("\u206610.00 DH\u2069"));
  });
});

describe("customer history", () => {
  const sale = (id: string, at: string, total: number, voided = false) => ({
    id,
    created_at: at,
    occurred_at: at,
    payment_method: "credit",
    total_cents: total,
    discount_cents: 0,
    customer_id: "c1",
    cashier_id: "u-2",
    voided_at: voided ? at : null,
    void_reason: null,
  });
  beforeEach(() => {
    mockBalance.mockResolvedValue(bal("c1", "Hélène", 1000, "0661 23 45 67"));
    mockSales.mockResolvedValue([
      sale("s2", "2026-11-17T10:00:00Z", 700, true),
      sale("s1", "2026-11-15T10:00:00Z", 1500),
    ]);
    mockPayments.mockResolvedValue([
      { id: "p1", amount_cents: 500, method: "cash", created_at: "2026-11-16T09:00:00Z" },
    ]);
    mockLines.mockResolvedValue([
      {
        id: "l1",
        sale_id: "s1",
        product_name: "Huile",
        unit: "piece",
        quantity: 2,
        unit_price_cents: 750,
        discount_cents: 0,
        line_total_cents: 1500,
      },
    ]);
  });

  it("lists sales and payments newest first, marks the voided sale", async () => {
    await render(<CustomerHistory />);
    const texts = allTexts(tree.root);
    const order = ["7.00 DH", "+5.00 DH", "15.00 DH"].map((v) =>
      texts.findIndex((x) => x.includes(v))
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(texts).toContain("credit.voidedTag");
    // the balance comes from the view, not from adding up the rows
    expect(texts.some((x) => x.includes("10.00 DH"))).toBe(true);
  });

  it("loads product lines through the role's view when a sale is opened", async () => {
    mockRole = "cashier";
    await render(<CustomerHistory />);
    const row = tree.root.find(
      (n) =>
        n.props.accessibilityLabel === "credit.showLines" &&
        typeof n.props.onPress === "function" &&
        textOf(n).includes("15.00 DH")
    );
    await act(async () => row.props.onPress());
    expect(mockLines).toHaveBeenCalledWith(["s1"], false);
    expect(allTexts(tree.root).join("|")).toContain("Huile");
    expect(allTexts(tree.root)).toContain("credit.cashierNote");
  });

  it("pages: a full page shows load more and asks for the next offset", async () => {
    const full = Array.from({ length: 30 }, (_, i) =>
      sale(`s${i}`, `2026-11-${String(28 - (i % 25)).padStart(2, "0")}T10:00:00Z`, 100)
    ).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    mockSales.mockResolvedValueOnce(full);
    await render(<CustomerHistory />);
    mockSales.mockResolvedValueOnce([]);
    await act(async () => pressableByText(tree.root, "credit.loadMore").props.onPress());
    expect(mockSales).toHaveBeenLastCalledWith("c1", 30, 30);
  });
});
