import React from "react";
import { StyleSheet } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import CreditScreen from "../../app/(app)/clients";
import SalesHistory from "../../app/(app)/sell/history";
import { StuckSalesList } from "../../src/components/shell/StuckSalesList";
import { pressableByText, sizeOf } from "./sellTestUtils";

const MIN = 48;

jest.mock("expo-router", () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock("react-i18next", () => {
  const t = (key: string) => key; // stable identity: screens use t in hook deps
  return { useTranslation: () => ({ t, i18n: { language: "fr" } }) };
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "owner", role: "owner" } }),
}));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchCustomerBalances: async () => [
    {
      id: "c1",
      name: "Fatima Zahra",
      phone: null,
      credit_total_cents: 6700,
      paid_total_cents: 600,
      balance_cents: 6100,
    },
  ],
  recordCustomerPayment: jest.fn(),
  fetchRecentSales: async () => [
    {
      id: "s1",
      created_at: "2026-01-15T10:00:00Z",
      payment_method: "cash",
      total_cents: 800,
      discount_cents: 0,
      customer_id: null,
      voided_at: null,
      void_reason: null,
    },
  ],
  voidSale: jest.fn(),
}));
jest.mock("../../src/lib/sales/offlineQueue", () => ({
  listStuckSales: async () => [
    {
      sale: {
        id: "abcdefgh-1",
        created_at: "2026-01-15T10:00:00Z",
        total_cents: 800,
        payment_method: "cash",
        lines: [],
      },
      error: "rejected",
    },
  ],
  retryStuckSale: jest.fn(),
  dismissStuckSale: jest.fn(),
}));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ sync: jest.fn() }),
}));

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

async function render(element: React.ReactElement) {
  await act(async () => {
    tree = create(element);
  });
}

describe("Sell sub-screen buttons are at least 48dp", () => {
  it("credit: record payment", async () => {
    await render(<CreditScreen />);
    expect(
      sizeOf(pressableByText(tree.root, "credit.recordPaymentButton")).minHeight
    ).toBeGreaterThanOrEqual(MIN);
  });

  it("history: void / refund", async () => {
    await render(<SalesHistory />);
    expect(sizeOf(pressableByText(tree.root, "sell.voidRefund")).minHeight).toBeGreaterThanOrEqual(
      MIN
    );
  });

  it("stuck sales (now in the shell's sync menu): retry, export and dismiss", async () => {
    await render(<StuckSalesList onRetry={async () => {}} onChanged={() => {}} />);
    for (const label of ["sell.stuck.retry", "sell.stuck.export", "sell.stuck.dismiss"]) {
      // BigButton is a component: its pressable child carries a style that is a
      // function of the pressed state. Resolve it.
      const pressable = pressableByText(tree.root, label).findAll(
        (n) => n.props.style !== undefined
      )[0];
      const style =
        typeof pressable.props.style === "function"
          ? pressable.props.style({ pressed: false })
          : pressable.props.style;
      const flat = StyleSheet.flatten(style) as { minHeight?: number };
      expect({ label, ok: (flat.minHeight ?? 0) >= MIN }).toEqual({ label, ok: true });
    }
  });
});
