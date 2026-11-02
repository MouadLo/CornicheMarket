import React from "react";
import { TextInput } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import Screen from "../../app/(app)/stock-in/count";
import { ProductSearchPicker } from "../../src/components/stock/ProductSearchPicker";
import { BigButton } from "../../src/components/BigButton";
const mockApply = jest.fn();
let mockSequence = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `operation-${++mockSequence}` }));
jest.mock("../../src/lib/products/queries", () => ({ fetchProductByBarcode: jest.fn() }));
jest.mock("../../src/lib/inventory/queries", () => ({
  applyStockCount: (...args: unknown[]) => mockApply(...args),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "owner" } }),
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock("../../src/lib/confirmDestructive", () => ({ confirmDestructive: async () => true }));
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: () => null,
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
let tree: ReactTestRenderer;
async function add(id: string) {
  await act(async () =>
    tree.root
      .findByType(ProductSearchPicker)
      .props.onPick({ id, name: id, stock_quantity: 10, unit: "piece" })
  );
  await act(async () => tree.root.findAllByType(TextInput).at(-1)!.props.onChangeText("8"));
}
async function apply() {
  await act(async () =>
    tree.root
      .findAllByType(BigButton)
      .find((x) => x.props.label === "stockIn.countApply")!
      .props.onPress()
  );
}
beforeEach(async () => {
  mockApply.mockReset().mockResolvedValue(-2);
  await act(async () => {
    tree = create(<Screen />);
  });
});
afterEach(() => act(() => tree.unmount()));
it("D8: applying B never sends completed A again", async () => {
  await add("A");
  await apply();
  await add("B");
  await apply();
  expect(mockApply.mock.calls.map((c) => c[0])).toEqual(["A", "B"]);
});
it("mixed failure keeps only failed B retryable", async () => {
  await add("A");
  await add("B");
  mockApply.mockResolvedValueOnce(-2).mockRejectedValueOnce(new Error("timeout"));
  await apply();
  expect(
    tree.root.findAllByType(BigButton).some((x) => x.props.label === "stockIn.countApply")
  ).toBe(true);
});
it("completed counts cannot be edited", async () => {
  await add("A");
  await apply();
  expect(tree.root.findByType(TextInput).props.editable).toBe(false);
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("7"));
  expect(tree.root.findByType(TextInput).props.value).toBe("8");
});
it("ambiguous response retries exactly the same operation", async () => {
  await add("A");
  mockApply.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(-2);
  await apply();
  await apply();
  expect(mockApply.mock.calls[0][5]).toEqual(expect.any(String));
  expect(mockApply.mock.calls[1]).toEqual(mockApply.mock.calls[0]);
});
