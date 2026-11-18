/**
 * Saving a product: a price of 0 or below the owner's cost asks first (nothing
 * is written on "no"), a good save shows a toast, and the form reports unsaved
 * changes so the screen can guard leaving.
 */
import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import { ProductForm } from "../../src/components/products/ProductForm";
import type { Product } from "../../src/lib/products/queries";

const mockConfirm = jest.fn();
const mockToast = jest.fn();
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: object) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "fr" },
  }),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../../src/components/products/BarcodeScannerModal", () => ({
  BarcodeScannerModal: () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  createCategory: jest.fn(),
  findByBarcode: jest.fn(async () => null),
}));
jest.mock("../../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
  showToast: (...a: unknown[]) => mockToast(...a),
}));

const product = {
  id: "p1",
  name: "Lait",
  barcode: null,
  category_id: null,
  unit: "piece",
  selling_price_cents: 800,
  current_cost_cents: 600,
  stock_quantity: 3,
  low_stock_threshold: 0,
  active: true,
} as unknown as Product;

const onSubmit = jest.fn(async () => {});
const onDirtyChange = jest.fn();
let tree: ReactTestRenderer;

const render = async (initial?: Product) => {
  await act(async () => {
    tree = create(
      <ProductForm
        categories={[]}
        initial={initial}
        submitLabel="save"
        onSubmit={onSubmit}
        onDirtyChange={onDirtyChange}
      />
    );
  });
};
const input = (placeholder: string) =>
  tree.root.findAllByType(TextInput).find((i) => i.props.placeholder === placeholder)!;
const setPrice = (value: string) => act(() => input("0.00").props.onChangeText(value));
const save = () =>
  act(async () => {
    await tree.root
      .findAllByType(BigButton)
      .find((b) => b.props.label === "save")!
      .props.onPress();
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirm.mockResolvedValue(true);
});
afterEach(() => act(() => tree?.unmount()));

it("shows a toast after a successful save", async () => {
  await render(product);
  await save();
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(mockToast).toHaveBeenCalledWith(
    expect.objectContaining({ text: "products.formSavedToast" })
  );
  expect(mockConfirm).not.toHaveBeenCalled();
});

it("asks before saving a price of 0, and writes nothing on no", async () => {
  mockConfirm.mockResolvedValue(false);
  await render(product);
  setPrice("0");
  await save();
  expect(mockConfirm.mock.calls[0][0].title).toBe("products.formZeroPriceTitle");
  expect(mockConfirm.mock.calls[0][0].message).toContain("0.00 DH");
  expect(onSubmit).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
});

it("asks before saving below cost, naming both amounts, and saves on yes", async () => {
  await render(product);
  setPrice("5");
  await save();
  const options = mockConfirm.mock.calls[0][0];
  expect(options.title).toBe("products.formBelowCostTitle");
  expect(options.message).toContain("5.00 DH");
  expect(options.message).toContain("6.00 DH");
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("never compares with a cost the cashier cannot see", async () => {
  await render({ ...product, current_cost_cents: null } as unknown as Product);
  setPrice("1");
  await save();
  expect(mockConfirm).not.toHaveBeenCalled();
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("reports unsaved changes, and clears them when saving", async () => {
  await render(product);
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  setPrice("9");
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  await save();
  expect(onDirtyChange).toHaveBeenCalledWith(false);
});

it("marks the form dirty again when the save fails", async () => {
  onSubmit.mockRejectedValueOnce(new Error("boom"));
  await render(product);
  setPrice("9");
  await save();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  expect(mockToast).not.toHaveBeenCalled();
});
