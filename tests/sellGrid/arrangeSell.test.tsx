import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

let mockRole = "owner";
const mockGrid = {
  products: [
    {
      id: "a",
      name: "Apple",
      barcode: null,
      category_id: "fruit",
      unit: "piece",
      selling_price_cents: 100,
      stock_quantity: 5,
      low_stock_threshold: 1,
      active: true,
    },
    {
      id: "b",
      name: "Banana",
      barcode: null,
      category_id: "fruit",
      unit: "piece",
      selling_price_cents: 200,
      stock_quantity: 5,
      low_stock_threshold: 1,
      active: true,
    },
  ],
  categories: [{ id: "fruit", name: "Fruit" }],
  tabs: [
    {
      id: "t",
      kind: "category",
      category_id: "fruit",
      label: null,
      position: 0,
      visible: true,
      auto_fill: true,
    },
  ],
  tiles: [],
};
const mockSave = jest.fn();

jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
    i18n: { language: "fr" },
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u", role: mockRole } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  getCachedGrid: async () => mockGrid,
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [],
  fetchProductByBarcode: async () => null,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sellGrid/queries", () => ({
  saveGridArrangement: (...args: unknown[]) => mockSave(...args),
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 0, stuck: 0, syncing: false, sync: jest.fn() }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

async function render(role: string) {
  mockRole = role;
  await act(async () => {
    tree = create(<SellScreen />);
  });
}
const hasLabel = (label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label).length > 0;

describe("arranging the Sell grid", () => {
  it("the owner has the control, the cashier does not", async () => {
    await render("owner");
    expect(hasLabel("sell.grid.arrange")).toBe(true);
    act(() => tree.unmount());
    await render("cashier");
    expect(hasLabel("sell.grid.arrange")).toBe(false);
  });

  it("a tap on a tile in arrange mode adds nothing to the basket, and Terminer saves", async () => {
    mockSave.mockResolvedValue(undefined);
    await render("owner");
    await act(async () => {
      tree.root
        .findAll((n) => n.props.accessibilityLabel === "sell.grid.arrange")[0]
        .props.onPress();
    });
    expect(allTexts(tree.root)).toContain("sell.grid.arrangeBanner");
    const tiles = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "sell.grid.tileLabelEmpty:Apple"
    );
    for (const node of tiles) expect(node.props.onPress).toBeUndefined();
    expect(allTexts(tree.root).join("|")).not.toContain("sell.basketItems");

    // Move Apple later, then Terminer: one save, then back to the normal grid.
    await act(async () => {
      tree.root
        .findAll(
          (n) =>
            n.props.accessibilityLabel === "sell.grid.moveLater:Apple" &&
            typeof n.props.onPress === "function"
        )[0]
        .props.onPress();
    });
    await act(async () => {
      pressableByText(tree.root, "sell.grid.arrangeDone").props.onPress();
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0].tiles).toEqual([
      { tab_id: "t", product_id: "b", position: 0, hidden: false },
      { tab_id: "t", product_id: "a", position: 1, hidden: false },
    ]);
    expect(allTexts(tree.root)).not.toContain("sell.grid.arrangeBanner");
    expect(hasLabel("sell.grid.arrange")).toBe(true);
    // Back in the normal grid, a tap adds the product again.
    await act(async () => {
      tree.root
        .findAll(
          (n) =>
            n.props.accessibilityLabel === "sell.grid.tileLabelEmpty:Apple" &&
            typeof n.props.onPress === "function"
        )[0]
        .props.onPress();
    });
    expect(allTexts(tree.root).join("|")).toContain("sell.basketItems");
  });
});
