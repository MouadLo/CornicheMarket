/**
 * Voiding a sale used to commit on one tap, right under the reason field --
 * no "are you sure", no statement of what it would do. These pin the gate:
 * voidSale is called only after confirmDestructive resolves true, and the
 * confirm dialog is asked for with a message naming the amount being
 * reversed.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SalesHistory from "../../app/(app)/sell/history";
import { pressableByText } from "./sellTestUtils";

const mockVoidSale = jest.fn(async (..._args: unknown[]) => {});
const mockConfirmDestructive = jest.fn(async (..._args: unknown[]) => true);

const sale = {
  id: "sale-1",
  created_at: "2026-10-31T12:00:00.000Z",
  payment_method: "cash",
  total_cents: 1450,
  discount_cents: 0,
  customer_id: null,
  voided_at: null,
  void_reason: null,
};

// history.tsx's load() is memoized on [t], so t must keep the same identity
// across renders -- a fresh arrow function per call (as inline mocks give
// you) retriggers the effect every render and spins forever.
const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "owner-1", role: "owner" } }),
}));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchRecentSales: async () => [sale],
  voidSale: (...args: unknown[]) => mockVoidSale(...args),
}));
jest.mock("../../src/lib/confirmDestructive", () => ({
  confirmDestructive: (...args: unknown[]) => mockConfirmDestructive(...args),
}));

let tree: ReactTestRenderer;
beforeEach(async () => {
  mockVoidSale.mockClear();
  mockConfirmDestructive.mockClear();
  mockConfirmDestructive.mockResolvedValue(true);
  await act(async () => {
    tree = create(<SalesHistory />);
  });
});
afterEach(() => act(() => tree.unmount()));

async function startVoid() {
  await act(async () => {
    pressableByText(tree.root, "sell.voidRefund").props.onPress();
  });
}

describe("void confirmation", () => {
  it("asks for confirmation naming the amount before voiding", async () => {
    await startVoid();
    await act(async () => {
      pressableByText(tree.root, "sell.voidAndRestore").props.onPress();
    });

    expect(mockConfirmDestructive).toHaveBeenCalledWith(
      "sell.voidConfirmTitle",
      'sell.voidConfirmMessage:{"amount":"14.50 DH"}',
      "sell.voidAndRestore",
      "common.cancel"
    );
    expect(mockVoidSale).toHaveBeenCalledWith("sale-1", expect.any(String));
  });

  it("does not void when the confirmation is declined", async () => {
    mockConfirmDestructive.mockResolvedValue(false);
    await startVoid();
    await act(async () => {
      pressableByText(tree.root, "sell.voidAndRestore").props.onPress();
    });

    expect(mockVoidSale).not.toHaveBeenCalled();
  });
});
