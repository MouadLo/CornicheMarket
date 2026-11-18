import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import AcceptInvite from "../../app/accept-invite";
import { BulkPriceModal } from "../../src/components/products/BulkPriceModal";
import { ProductRow } from "../../src/components/products/ProductRow";
import { PriceHistoryChart } from "../../src/components/stock/PriceHistoryChart";
import { BigButton } from "../../src/components/BigButton";
import { isolateBidi } from "../../src/lib/text/bidi";
import { hardcodedTexts, pressableByText } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `⟦${key}⟧`,
    i18n: { language: "fr" },
  }),
}));

let mockSession: unknown = null;
const mockSignOut = jest.fn(async () => {});
jest.mock("@/src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ session: mockSession, signOut: mockSignOut }),
}));
const mockUpdateUser = jest.fn();
jest.mock("@/src/lib/supabase/client", () => ({
  supabase: { auth: { updateUser: (...args: unknown[]) => mockUpdateUser(...args) } },
}));
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock("@/src/lib/dialog/store", () => ({ confirm: jest.fn(), showToast: jest.fn() }));
jest.mock("@/src/lib/products/queries", () => ({
  fetchBulkPriceTargets: jest.fn(),
  bulkAdjustSellingPrice: jest.fn(),
}));

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

const product = {
  id: "p1",
  name: "Coca-Cola 33cl",
  barcode: null,
  unit: "piece",
  selling_price_cents: 700,
  stock_quantity: 3,
  is_low_stock: true,
  active: false,
  current_cost_cents: 0,
} as never;

describe("no hard-coded text", () => {
  it("ProductRow: owner without a cost, low and inactive", () => {
    act(() => {
      tree = create(<ProductRow product={product} showCost />);
    });
    expect(hardcodedTexts(tree.root, [isolateBidi("Coca-Cola 33cl")])).toEqual([]);
  });

  it("ProductRow: owner with a cost", () => {
    act(() => {
      tree = create(
        <ProductRow
          product={{ ...(product as object), current_cost_cents: 500 } as never}
          showCost
        />
      );
    });
    expect(hardcodedTexts(tree.root, [isolateBidi("Coca-Cola 33cl"), "+2.00 DH · 28.6%"])).toEqual(
      []
    );
  });

  it("BulkPriceModal", () => {
    act(() => {
      tree = create(
        <BulkPriceModal visible categories={[]} onClose={() => {}} onApplied={() => {}} />
      );
    });
    expect(hardcodedTexts(tree.root)).toEqual([]);
  });

  it("PriceHistoryChart", () => {
    act(() => {
      tree = create(
        <PriceHistoryChart
          points={[
            { id: "a", created_at: "2026-01-05T10:00:00Z", quantity: 1, unit_cost_cents: 500 },
            { id: "b", created_at: "2026-02-05T10:00:00Z", quantity: 1, unit_cost_cents: 600 },
          ]}
          averageCostCents={550}
        />
      );
    });
    expect(hardcodedTexts(tree.root)).toEqual([]);
  });

  it("accept-invite: form, expired link and done", async () => {
    mockSession = { user: { email: "cashier@shop.ma" } };
    mockUpdateUser.mockResolvedValue({ error: null });
    await act(async () => {
      tree = create(<AcceptInvite />);
    });
    expect(hardcodedTexts(tree.root)).toEqual([]);

    act(() => tree.unmount());
    mockSession = null;
    act(() => {
      tree = create(<AcceptInvite />);
    });
    expect(hardcodedTexts(tree.root)).toEqual([]);
  });
});

it("accept-invite ends on a button to sign-in once the password is set", async () => {
  mockSession = { user: { email: "cashier@shop.ma" } };
  mockUpdateUser.mockResolvedValue({ error: null });
  await act(async () => {
    tree = create(<AcceptInvite />);
  });
  const { TextInput } = jest.requireActual("react-native");
  act(() => {
    tree.root.findByType(TextInput).props.onChangeText("secret1");
  });
  await act(async () => {
    await tree.root.findAllByType(BigButton)[0].props.onPress();
  });
  expect(mockUpdateUser).toHaveBeenCalledWith({ password: "secret1" });
  expect(hardcodedTexts(tree.root)).toEqual([]);

  await act(async () => {
    await pressableByText(tree.root, "⟦invite.goSignIn⟧").props.onPress();
  });
  expect(mockSignOut).toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith("/sign-in");
});
