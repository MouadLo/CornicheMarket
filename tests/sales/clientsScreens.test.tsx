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
const mockReturns = jest.fn();
const mockLines = jest.fn();
const mockPush = jest.fn();
const mockUpdateLimit = jest.fn(async (..._a: unknown[]) => {});

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
  fetchCustomerCreditReturns: (...a: unknown[]) => mockReturns(...a),
  fetchSaleLines: (...a: unknown[]) => mockLines(...a),
  recordCustomerPayment: jest.fn(),
  fetchStoreCreditLimit: async () => 30000,
  updateCustomerCreditLimit: (...a: unknown[]) => mockUpdateLimit(...a),
}));

const bal = (id: string, name: string, balance: number, phone: string | null = null) => ({
  id,
  name,
  phone,
  credit_total_cents: Math.max(balance, 0),
  paid_total_cents: 0,
  balance_cents: balance,
  credit_limit_cents: 30000,
  credit_available_cents: 30000,
  credit_limit_override_cents: null as number | null,
});

let tree: ReactTestRenderer;
const render = async (el: React.ReactElement) => {
  await act(async () => {
    tree = create(el);
  });
};
beforeEach(() => {
  mockRole = "owner";
  [
    mockBalances,
    mockBalance,
    mockSales,
    mockPayments,
    mockReturns,
    mockLines,
    mockPush,
    mockUpdateLimit,
  ].forEach((m) => m.mockReset());
  mockReturns.mockResolvedValue([]);
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

describe("clients list: failed and empty reads", () => {
  it("a failed read is an error with Retry, never 'nobody owes' or a total of 0", async () => {
    mockBalances.mockRejectedValue(new TypeError("Failed to fetch"));
    await render(<CreditScreen />);
    const shown = allTexts(tree.root);
    expect(shown).toContain("credit.loadError");
    expect(shown.join("|")).toContain("errors.network");
    expect(shown.join("|")).toContain("errors.offlineExplain");
    expect(shown.join("|")).not.toContain("Failed to fetch");
    expect(shown).not.toContain("credit.nobody");
    expect(shown).not.toContain("credit.emptyTitle");
    expect(shown).not.toContain("credit.totalOwed");
    expect(shown.join("|")).not.toContain("0.00 DH");

    mockBalances.mockResolvedValue([bal("c1", "Hélène", 1000)]);
    await act(async () => pressableByText(tree.root, "common.retry").props.onPress());
    expect(allTexts(tree.root)).not.toContain("credit.loadError");
    expect(allTexts(tree.root).join("|")).toContain("Hélène");
  });

  it("raw server text is never shown", async () => {
    mockBalances.mockRejectedValue(new Error("permission denied for table customers"));
    await render(<CreditScreen />);
    expect(allTexts(tree.root).join("|")).not.toContain("permission denied");
    expect(allTexts(tree.root).join("|")).toContain("errors.permission");
  });

  it("a real empty list says there are no customers yet", async () => {
    mockBalances.mockResolvedValue([]);
    await render(<CreditScreen />);
    expect(allTexts(tree.root)).toContain("credit.emptyTitle");
    expect(allTexts(tree.root)).not.toContain("credit.loadError");
  });
});

describe("customer history", () => {
  const sale = (id: string, at: string, total: number, voided = false, own = true) => ({
    id,
    created_at: at,
    occurred_at: at,
    total_cents: total,
    voided_at: voided ? at : null,
    cashier_name: own ? "Amina" : "Youssef",
    is_own: own,
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

  it("a failed read shows the error and Retry, not 'customer not found'", async () => {
    mockBalance.mockRejectedValue(new TypeError("Failed to fetch"));
    await render(<CustomerHistory />);
    const shown = allTexts(tree.root);
    expect(shown).toContain("credit.historyLoadError");
    expect(shown.join("|")).toContain("errors.network");
    expect(shown).not.toContain("credit.notFound");
    expect(shown).not.toContain("credit.noHistory");
    mockBalance.mockResolvedValue(bal("c1", "Hélène", 1000));
    await act(async () => pressableByText(tree.root, "common.retry").props.onPress());
    expect(allTexts(tree.root).join("|")).toContain("Hélène");
  });

  it("a customer that really does not exist still says so", async () => {
    mockBalance.mockResolvedValue(null);
    await render(<CustomerHistory />);
    expect(allTexts(tree.root)).toContain("credit.notFound");
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

  it("shows a credit return between the payment and the sale, like a payment lowering the debt", async () => {
    mockReturns.mockResolvedValue([
      {
        id: "r1",
        created_at: "2026-11-16T12:00:00Z",
        refund_cents: 400,
        sale_id: "s1",
        item_count: 2,
        occurred_at: "2026-11-15T10:00:00Z",
      },
    ]);
    await render(<CustomerHistory />);
    expect(mockReturns).toHaveBeenCalledWith("c1", 30, 0);
    const texts = allTexts(tree.root);
    expect(texts).toContain("credit.timelineReturn");
    expect(texts).toContain('credit.returnItems{"count":2}');
    const order = ["7.00 DH", "⁦−4.00 DH⁩", "+5.00 DH", "15.00 DH"].map((v) =>
      texts.findIndex((x) => x.includes(v))
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("pages the returns on their own offset", async () => {
    const full = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      created_at: `2026-11-${String(28 - i).padStart(2, "0")}T12:00:00Z`,
      refund_cents: 100,
      sale_id: "s1",
      item_count: 1,
      occurred_at: "2026-11-01T10:00:00Z",
    }));
    mockReturns.mockResolvedValueOnce(full);
    await render(<CustomerHistory />);
    mockReturns.mockResolvedValueOnce([]);
    await act(async () => pressableByText(tree.root, "credit.loadMore").props.onPress());
    expect(mockReturns).toHaveBeenLastCalledWith("c1", 30, 30);
  });

  const showLinesRows = () =>
    tree.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "credit.showLines" &&
        typeof n.props.onPress === "function" &&
        n.parent?.props.accessibilityLabel !== "credit.showLines"
    );

  it("loads product lines through the role's view when the cashier opens their own sale", async () => {
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
    expect(allTexts(tree.root).join("|")).not.toContain("credit.cashierNote");
  });

  it("a cashier sees another person's credit sale and who rang it up, with no expand control", async () => {
    mockRole = "cashier";
    mockSales.mockResolvedValue([
      sale("s9", "2026-11-17T10:00:00Z", 900, false, false),
      sale("s1", "2026-11-15T10:00:00Z", 1500),
    ]);
    await render(<CustomerHistory />);
    const texts = allTexts(tree.root).join("|");
    expect(texts).toContain("9.00 DH");
    expect(texts).toContain('credit.rungUpBy{"name":"\u2068Youssef\u2069"}');
    // only the cashier's own sale can be opened, and nothing is fetched for the other
    expect(showLinesRows()).toHaveLength(1);
    expect(mockLines).not.toHaveBeenCalled();
  });

  it("the owner can open every sale", async () => {
    mockRole = "owner";
    mockSales.mockResolvedValue([
      sale("s9", "2026-11-17T10:00:00Z", 900, false, false),
      sale("s1", "2026-11-15T10:00:00Z", 1500),
    ]);
    await render(<CustomerHistory />);
    const rows = showLinesRows();
    expect(rows).toHaveLength(2);
    await act(async () => rows[0].props.onPress());
    expect(mockLines).toHaveBeenCalledWith(["s9"], true);
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

describe("customer credit limit editor", () => {
  beforeEach(() => {
    mockBalance.mockResolvedValue(bal("c1", "Hélène", 1000));
    mockSales.mockResolvedValue([]);
    mockPayments.mockResolvedValue([]);
  });

  it("the owner sees the editor with the store limit, a custom amount and no credit", async () => {
    await render(<CustomerHistory />);
    const shown = allTexts(tree.root).join("|");
    expect(shown).toContain("credit.limitTitle");
    expect(shown).toContain("credit.limitStoreOption");
    expect(shown).toContain("credit.limitCustomOption");
    expect(shown).toContain("credit.limitNoneOption");
  });

  it("a cashier never sees the editor", async () => {
    mockRole = "cashier";
    await render(<CustomerHistory />);
    const shown = allTexts(tree.root).join("|");
    expect(shown).not.toContain("credit.limitTitle");
    expect(shown).not.toContain("credit.limitSave");
  });

  it("saves a custom limit in centimes", async () => {
    await render(<CustomerHistory />);
    await act(async () => pressableByText(tree.root, "credit.limitCustomOption").props.onPress());
    const input = tree.root
      .findAllByType(TextInput)
      .find((n) => n.props.accessibilityLabel === "credit.limitAmount")!;
    await act(async () => input.props.onChangeText("500"));
    await act(async () => pressableByText(tree.root, "credit.limitSave").props.onPress());
    expect(mockUpdateLimit).toHaveBeenCalledWith("c1", 50000);
  });

  it("saves 'no credit' as 0 and the store limit as null", async () => {
    await render(<CustomerHistory />);
    await act(async () => pressableByText(tree.root, "credit.limitNoneOption").props.onPress());
    await act(async () => pressableByText(tree.root, "credit.limitSave").props.onPress());
    expect(mockUpdateLimit).toHaveBeenLastCalledWith("c1", 0);
    await act(async () =>
      pressableByText(
        tree.root,
        'credit.limitStoreOption{"amount":"\u2066300.00 DH\u2069"}'
      ).props.onPress()
    );
    await act(async () => pressableByText(tree.root, "credit.limitSave").props.onPress());
    expect(mockUpdateLimit).toHaveBeenLastCalledWith("c1", null);
  });

  it("refuses an amount that is not a number", async () => {
    await render(<CustomerHistory />);
    await act(async () => pressableByText(tree.root, "credit.limitCustomOption").props.onPress());
    const input = tree.root
      .findAllByType(TextInput)
      .find((n) => n.props.accessibilityLabel === "credit.limitAmount")!;
    await act(async () => input.props.onChangeText("abc"));
    await act(async () => pressableByText(tree.root, "credit.limitSave").props.onPress());
    expect(mockUpdateLimit).not.toHaveBeenCalled();
  });
});
