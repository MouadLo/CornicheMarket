/**
 * A stock adjustment used to commit on one tap -- pick a reason, type a
 * number, done. These pin the gate: createAdjustment is called only after
 * confirmDestructive resolves true, with a confirm message stating the
 * stock change (the same text the inline preview already showed).
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import AdjustScreen from "../../app/(app)/stock-in/adjust";
import { ProductSearchPicker } from "../../src/components/stock/ProductSearchPicker";
import { pressableByText } from "../sales/sellTestUtils";

const mockCreateAdjustment = jest.fn(async (..._args: unknown[]) => {});
const mockConfirmDestructive = jest.fn(async (..._args: unknown[]) => true);

const product = {
  id: "p1",
  name: "Coca-Cola 33cl",
  unit: "piece",
  stock_quantity: 20,
  current_cost_cents: 600,
};

const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "owner-1", role: "owner" } }),
}));
jest.mock("../../src/lib/inventory/queries", () => ({
  ADJUSTMENT_REASONS: [
    { value: "damaged", label: "Damaged" },
    { value: "expired", label: "Expired" },
    { value: "theft", label: "Theft" },
    { value: "count_correction", label: "Count correction" },
  ],
  createAdjustment: (...args: unknown[]) => mockCreateAdjustment(...args),
  fetchRecentAdjustments: async () => [],
}));
jest.mock("../../src/lib/confirmDestructive", () => ({
  confirmDestructive: (...args: unknown[]) => mockConfirmDestructive(...args),
}));
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: ({ onPick }: { onPick: (p: typeof product) => void }) => {
    const { Pressable, Text } = jest.requireActual("react-native");
    return (
      <Pressable onPress={() => onPick(product)}>
        <Text>pick-product</Text>
      </Pressable>
    );
  },
}));

let tree: ReactTestRenderer;
beforeEach(async () => {
  mockCreateAdjustment.mockClear();
  mockConfirmDestructive.mockClear();
  mockConfirmDestructive.mockResolvedValue(true);
  await act(async () => {
    tree = create(<AdjustScreen />);
  });
  await act(async () => {
    tree.root.findByType(ProductSearchPicker).props.onPick(product);
  });
});
afterEach(() => act(() => tree.unmount()));

async function enterLoss(amount: string) {
  const input = tree.root.findAllByProps({ keyboardType: "decimal-pad" })[0];
  await act(async () => input.props.onChangeText(amount));
}

describe("stock-adjustment confirmation", () => {
  it("asks for confirmation naming the stock change before saving", async () => {
    await enterLoss("3");
    await act(async () => {
      pressableByText(tree.root, "stockIn.adjustRecord").props.onPress();
    });

    expect(mockConfirmDestructive).toHaveBeenCalledWith(
      "stockIn.adjustConfirmTitle",
      'stockIn.adjustPreview:{"before":20,"after":17,"unit":"piece"} · 18.00 DH',
      "common.confirm",
      "common.cancel"
    );
    expect(mockCreateAdjustment).toHaveBeenCalledWith("p1", -3, "damaged", null, "owner-1");
  });

  it("does not save when the confirmation is declined", async () => {
    mockConfirmDestructive.mockResolvedValue(false);
    await enterLoss("3");
    await act(async () => {
      pressableByText(tree.root, "stockIn.adjustRecord").props.onPress();
    });

    expect(mockCreateAdjustment).not.toHaveBeenCalled();
  });
});
