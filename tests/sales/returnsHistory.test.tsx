/**
 * Item returns in the sales history: the owner returns items from an open sale
 * (confirmed first, with the refund amount), a cashier sees the button disabled
 * with a hint, and returned items and the sale total after returns are shown.
 */
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { TextInput } from "react-native";

import SalesHistory from "../../app/(app)/sell/history";
import { allTexts, pressableByText } from "./sellTestUtils";

const mockFetchRecent = jest.fn();
const mockFetchLines = jest.fn();
const mockFetchReturns = jest.fn();
const mockFetchReturnable = jest.fn();
const mockRecordReturn = jest.fn(async (..._a: unknown[]) => {});
const mockConfirm = jest.fn(async (..._a: unknown[]) => true);
let mockRole: "owner" | "cashier" = "owner";
let mockUuid = 0;

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
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
jest.mock("expo-crypto", () => ({ randomUUID: () => `return-${++mockUuid}` }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: mockRole } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: "UTC", error: null }) },
}));
jest.mock("../../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
  showToast: jest.fn(),
}));
jest.mock("../../src/lib/sales/queries", () => ({
  ...jest.requireActual("../../src/lib/sales/queries"),
  fetchRecentSales: (...a: unknown[]) => mockFetchRecent(...a),
  fetchSaleLines: (...a: unknown[]) => mockFetchLines(...a),
  fetchSaleReturns: (...a: unknown[]) => mockFetchReturns(...a),
  fetchReturnableLines: (...a: unknown[]) => mockFetchReturnable(...a),
  recordSaleReturn: (...a: unknown[]) => mockRecordReturn(...a),
  voidSale: jest.fn(),
}));
jest.mock("../../src/lib/sales/voidRequests", () => ({
  ...jest.requireActual("../../src/lib/sales/voidRequests"),
  fetchMyVoidRequests: async () => [],
}));

const sale = (id: string, total: number, extra: object = {}) => ({
  id,
  created_at: "2026-11-17T10:00:00Z",
  occurred_at: "2026-11-17T10:00:00Z",
  payment_method: "cash",
  total_cents: total,
  discount_cents: 0,
  customer_id: null,
  cashier_id: "u-1",
  voided_at: null,
  void_reason: null,
  ...extra,
});
const line = (id: string, saleId: string, name: string, quantity: number, total: number) => ({
  id,
  sale_id: saleId,
  product_name: name,
  unit: "piece",
  quantity,
  unit_price_cents: total / quantity,
  discount_cents: 0,
  line_total_cents: total,
});
const returnRecord = (saleId: string, lineId: string, quantity: number, refund: number) => ({
  id: `r-${saleId}`,
  saleId,
  createdAt: "2026-11-17T11:00:00Z",
  reasonCode: "damaged",
  note: null,
  refundMethod: "cash",
  refundCents: refund,
  items: [{ saleItemId: lineId, quantity, refundCents: refund }],
});

// "fresh": nothing returned yet. "part": 2 of 3 Lait handed back. "all": everything.
const sales = [sale("fresh", 3000), sale("part", 2000), sale("all", 1000)];
const lines = [
  line("f1", "fresh", "Lait", 3, 3000),
  line("p1", "part", "Pain", 2, 2000),
  line("a1", "all", "Sucre", 1, 1000),
];
const returns = [returnRecord("part", "p1", 1, 900), returnRecord("all", "a1", 1, 1000)];

let tree: ReactTestRenderer;
beforeEach(() => {
  mockRole = "owner";
  mockUuid = 0;
  mockFetchRecent.mockReset().mockResolvedValue(sales);
  mockFetchLines.mockReset().mockResolvedValue(lines);
  mockFetchReturns.mockReset().mockResolvedValue(returns);
  mockFetchReturnable
    .mockReset()
    .mockResolvedValue([
      { saleItemId: "f1", quantity: 3, returnedQuantity: 0, paidCents: 2657, refundedCents: 0 },
    ]);
  mockRecordReturn.mockReset().mockResolvedValue(undefined);
  mockConfirm.mockReset().mockResolvedValue(true);
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
const joined = () => allTexts(tree.root).join("|");
// A pressable shows up as several nodes (the component and what it renders):
// keep the outermost of each.
const outermost = (nodes: ReactTestInstance[]) =>
  nodes.filter((node) => !nodes.some((other) => other !== node && isAncestor(other, node)));
const isAncestor = (maybe: ReactTestInstance, node: ReactTestInstance): boolean => {
  for (let up = node.parent; up; up = up.parent) if (up === maybe) return true;
  return false;
};
const buttons = (label: string) =>
  outermost(
    tree.root.findAll(
      (n) => typeof n.props.onPress === "function" && allTexts(n).join("") === label
    )
  );
const returnButtons = () => buttons("returns.action");
const money = (text: string) => `⁦${text}⁩`;

describe("returns in the history", () => {
  it("shows returned items, a badge, and the sale total after returns", async () => {
    await render();
    expect(mockFetchReturns).toHaveBeenCalledWith(["fresh", "part", "all"]);
    expect(joined()).toContain('returns.badge:{"count":1}');
    // 20.00 DH sale, 9.00 DH refunded.
    expect(joined()).toContain(`returns.netTotal:{"amount":"${money("11.00 DH")}"}`);
    // The sale without returns shows neither.
    expect(joined().match(/returns\.badge/g)).toHaveLength(2);
  });

  it("lists what was handed back when the sale is opened", async () => {
    await render();
    const rows = outermost(
      tree.root.findAll(
        (n) =>
          n.props.accessibilityLabel === "sell.historyOpen" && typeof n.props.onPress === "function"
      )
    );
    // Rows are in list order: fresh, part, all.
    await act(async () => rows[1].props.onPress());
    expect(joined()).toContain(
      `returns.returnedLine:{"quantity":"1 ×","name":"⁨Pain⁩","amount":"${money("9.00 DH")}"}`
    );
  });

  it("does not let a sale with returns be voided, and says why", async () => {
    await render();
    // Only the untouched sale keeps its void button.
    expect(buttons("sell.voidRefund")).toHaveLength(1);
    expect(joined()).toContain("returns.noVoid");
  });

  it("offers the return only where something is left to hand back", async () => {
    await render();
    expect(returnButtons()).toHaveLength(2); // fresh and part; "all" is done
  });

  it("owner: opens the sheet, confirms with the refund amount, and records it once", async () => {
    await render();
    await act(async () => returnButtons()[0].props.onPress());
    expect(mockFetchReturnable).toHaveBeenCalledWith("fresh");

    const more = tree.root.find(
      (n) =>
        typeof n.props.onPress === "function" &&
        String(n.props.accessibilityLabel).startsWith("returns.more")
    );
    await act(async () => more.props.onPress());
    await act(async () => pressableByText(tree.root, "returns.reasonDamaged").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.confirm").props.onPress());

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({
      tone: "danger",
      title: "returns.confirmTitle",
      message: `returns.confirmMessage:${JSON.stringify({
        amount: money("8.86 DH"),
        method: "returns.refundCash",
      })}`,
    });
    expect(mockRecordReturn).toHaveBeenCalledWith({
      returnId: "return-1",
      saleId: "fresh",
      items: [{ sale_item_id: "f1", quantity: 1 }],
      reasonCode: "damaged",
      note: "",
      refundMethod: "cash",
    });
    // Reloaded after the return, and the sheet is closed.
    expect(mockFetchRecent).toHaveBeenCalledTimes(2);
    expect(() => pressableByText(tree.root, "returns.confirm")).toThrow();
  });

  it("records nothing when the owner declines the confirmation", async () => {
    mockConfirm.mockResolvedValue(false);
    await render();
    await act(async () => returnButtons()[0].props.onPress());
    const more = tree.root.find(
      (n) =>
        typeof n.props.onPress === "function" &&
        String(n.props.accessibilityLabel).startsWith("returns.more")
    );
    await act(async () => more.props.onPress());
    await act(async () => pressableByText(tree.root, "returns.reasonDamaged").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.confirm").props.onPress());
    expect(mockRecordReturn).not.toHaveBeenCalled();
  });

  it("offline: says so, keeps the sheet, and retries with the same return id", async () => {
    mockRecordReturn.mockRejectedValueOnce(new Error("Failed to fetch"));
    await render();
    await act(async () => returnButtons()[0].props.onPress());
    const more = tree.root.find(
      (n) =>
        typeof n.props.onPress === "function" &&
        String(n.props.accessibilityLabel).startsWith("returns.more")
    );
    await act(async () => more.props.onPress());
    await act(async () => pressableByText(tree.root, "returns.reasonDamaged").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.confirm").props.onPress());
    expect(joined()).toContain("errors.network");
    expect(mockFetchRecent).toHaveBeenCalledTimes(1);

    await act(async () => pressableByText(tree.root, "returns.confirm").props.onPress());
    expect(mockRecordReturn).toHaveBeenCalledTimes(2);
    expect(mockRecordReturn.mock.calls[0][0]).toMatchObject({ returnId: "return-1" });
    expect(mockRecordReturn.mock.calls[1][0]).toMatchObject({ returnId: "return-1" });
  });

  it("shows a translated refusal when the sheet cannot be opened", async () => {
    mockFetchReturnable.mockRejectedValueOnce(new Error("Failed to fetch"));
    await render();
    await act(async () => returnButtons()[0].props.onPress());
    expect(joined()).toContain("errors.network");
    expect(mockFetchReturnable).toHaveBeenCalledTimes(1);
    expect(() => pressableByText(tree.root, "returns.confirm")).toThrow();
  });

  it("cashier: the button is disabled with a hint, and nothing is fetched", async () => {
    mockRole = "cashier";
    await render();
    const [first] = returnButtons();
    expect(first.props.disabled).toBe(true);
    await act(async () => first.props.onPress?.());
    expect(mockFetchReturnable).not.toHaveBeenCalled();
    expect(joined()).toContain("returns.askOwnerHint");
    // A cashier still sees what was returned, and cannot ask to void such a sale.
    expect(joined()).toContain("returns.badge");
    expect(buttons("sell.askVoid")).toHaveLength(1);
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  });
});
