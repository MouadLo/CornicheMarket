/**
 * Voided deliveries stay in the history, struck through and labelled, and
 * every delivery opens its detail screen (where it can be voided).
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import PurchaseHistory from "../../app/(app)/stock-in/history";
import { textOf } from "../sales/sellTestUtils";

const mockPush = jest.fn();
const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("../../src/lib/stock/queries", () => ({
  fetchPurchases: async () => [
    {
      id: "ok",
      purchase_date: "2026-10-31T10:00:00Z",
      notes: null,
      supplier_id: null,
      supplier_name: "Atlas",
      total_cents: 5000,
      line_count: 2,
      voided_at: null,
      void_reason: null,
    },
    {
      id: "bad",
      purchase_date: "2026-10-30T10:00:00Z",
      notes: null,
      supplier_id: null,
      supplier_name: "Gros",
      total_cents: 9000,
      line_count: 1,
      voided_at: "2026-10-30T11:00:00Z",
      void_reason: "typo",
    },
  ],
  fetchMonthlyTotals: async () => [],
  fetchSupplierTotals: async () => [],
}));

let tree: ReactTestRenderer;
beforeEach(async () => {
  mockPush.mockClear();
  await act(async () => {
    tree = create(<PurchaseHistory />);
  });
});
afterEach(() => act(() => tree.unmount()));

describe("purchase history", () => {
  it("labels a voided delivery and keeps it in the list", () => {
    const text = textOf(tree.root);
    expect(text).toContain("Gros");
    expect(text).toContain("stockIn.historyVoidedTag");
    expect(text).toContain("typo");
  });

  it("does not label a normal delivery", () => {
    const rows = tree.root.findAll(
      (n) => typeof n.props.onPress === "function" && textOf(n).includes("Atlas")
    );
    expect(textOf(rows[0])).not.toContain("stockIn.historyVoidedTag");
  });

  it("opens the delivery's detail screen when a row is tapped", () => {
    const row = tree.root.findAll(
      (n) => typeof n.props.onPress === "function" && textOf(n).includes("Atlas")
    )[0];
    act(() => row.props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/stock-in/delivery/ok");
  });
});
