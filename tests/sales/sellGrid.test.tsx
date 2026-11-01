import React from "react";
import { Dimensions } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ProductGrid } from "../../src/components/sell/ProductGrid";
import { resolveGrid, type GridProduct } from "../../src/lib/sellGrid/layout";
import { allTexts } from "./sellTestUtils";

let mockWidth = 1366;
jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "fr" },
  }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [],
  fetchProductByBarcode: async () => null,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 0, stuck: 0, syncing: false, sync: jest.fn() }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async () => null,
  searchCachedProducts: async () => [],
  getCachedGrid: async () => ({
    categories: [
      { id: "c1", name: "Boissons" },
      { id: "c2", name: "Boulangerie" },
    ],
    tabs: [
      {
        id: "fav",
        kind: "favorites",
        category_id: null,
        label: null,
        position: 0,
        visible: true,
        auto_fill: false,
      },
      {
        id: "t1",
        kind: "category",
        category_id: "c1",
        label: null,
        position: 1,
        visible: true,
        auto_fill: true,
      },
      {
        id: "t2",
        kind: "category",
        category_id: "c2",
        label: null,
        position: 2,
        visible: true,
        auto_fill: true,
      },
    ],
    tiles: [
      {
        id: "x",
        tab_id: "fav",
        product_id: "p-pain",
        position: 1,
        hidden: false,
        pinned: false,
        color: null,
        short_label: null,
      },
    ],
    products: [
      {
        id: "p-coca",
        barcode: null,
        name: "Coca",
        unit: "piece",
        selling_price_cents: 700,
        active: true,
        category_id: "c1",
        stock_quantity: 9,
        low_stock_threshold: 12,
      },
      {
        id: "p-eau",
        barcode: null,
        name: "Eau",
        unit: "piece",
        selling_price_cents: 600,
        active: true,
        category_id: "c1",
        stock_quantity: 0,
        low_stock_threshold: 24,
      },
      {
        id: "p-pain",
        barcode: null,
        name: "Pain",
        unit: "piece",
        selling_price_cents: 120,
        active: true,
        category_id: "c2",
        stock_quantity: 24,
        low_stock_threshold: 10,
      },
      {
        id: "p-kg",
        barcode: null,
        name: "Tomates",
        unit: "kg",
        selling_price_cents: 900,
        active: true,
        category_id: "c2",
        stock_quantity: 12.4,
        low_stock_threshold: 5,
      },
    ],
  }),
}));

const P = (id: string, name: string, extra: Partial<GridProduct> = {}): GridProduct => ({
  id,
  name,
  barcode: null,
  category_id: "c1",
  unit: "piece",
  selling_price_cents: 700,
  stock_quantity: 9,
  low_stock_threshold: 2,
  active: true,
  ...extra,
});

let tree: ReactTestRenderer;
beforeEach(() => {
  mockWidth = 1366;
  jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: mockWidth, height: 768, scale: 1, fontScale: 1 }));
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

const tiles = (root: ReactTestInstance) =>
  root.findAll(
    (n) =>
      typeof n.props.accessibilityLabel === "string" &&
      n.props.accessibilityRole === "button" &&
      typeof n.props.onPress === "function"
  );
const labelOf = (n: ReactTestInstance) => n.props.accessibilityLabel as string;
// The test's t() returns "key{json}": read the product name out of the options.
const nameOf = (n: ReactTestInstance) =>
  JSON.parse(labelOf(n).slice(labelOf(n).indexOf("{"))).name as string;

describe("ProductGrid", () => {
  const tabs = resolveGrid({
    tabs: [
      {
        id: "t1",
        kind: "category",
        category_id: "c1",
        label: null,
        position: 1,
        visible: true,
        auto_fill: true,
      },
      {
        id: "t2",
        kind: "category",
        category_id: "c2",
        label: null,
        position: 2,
        visible: true,
        auto_fill: true,
      },
    ],
    tiles: [],
    categories: [
      { id: "c1", name: "Boissons" },
      { id: "c2", name: "Boulangerie" },
    ],
    favoritesLabel: "Favoris",
    products: [
      P("a", "Coca"),
      P("b", "Eau", { stock_quantity: 0 }),
      P("c", "Pain", { category_id: "c2" }),
    ],
  });

  it("shows the first tab's tiles, and switching tabs shows the other's", () => {
    act(() => {
      tree = create(<ProductGrid tabs={tabs} inCart={{}} onAdd={() => {}} />);
    });
    expect(
      tiles(tree.root)
        .filter((n) => labelOf(n).startsWith("sell.grid.tileLabel"))
        .map(nameOf)
    ).toEqual(expect.arrayContaining(["Coca", "Eau"]));
    const tab = tree.root
      .findAll((n) => n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function")
      .find((n) => allTexts(n).some((t) => t.includes("Boulangerie")))!;
    act(() => tab.props.onPress());
    expect(
      tiles(tree.root)
        .filter((n) => labelOf(n).startsWith("sell.grid.tileLabel"))
        .map(nameOf)
    ).toContain("Pain");
  });

  it("tapping a tile adds that product", () => {
    const onAdd = jest.fn();
    act(() => {
      tree = create(<ProductGrid tabs={tabs} inCart={{}} onAdd={onAdd} />);
    });
    act(() =>
      tiles(tree.root)
        .find((n) => labelOf(n).startsWith("sell.grid.tileLabel") && nameOf(n) === "Coca")!
        .props.onPress()
    );
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "a", name: "Coca" }));
  });

  it("an out-of-stock tile is still tappable and shows its stock", () => {
    const onAdd = jest.fn();
    act(() => {
      tree = create(<ProductGrid tabs={tabs} inCart={{}} onAdd={onAdd} />);
    });
    const eau = tiles(tree.root).find(
      (n) => labelOf(n).startsWith("sell.grid.tileLabel") && nameOf(n) === "Eau"
    )!;
    act(() => eau.props.onPress());
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(allTexts(eau)).toContain(isolate("0"));
  });

  it("shows ×N for what is in the basket, and says so in the accessible label", () => {
    act(() => {
      tree = create(<ProductGrid tabs={tabs} inCart={{ a: 3 }} onAdd={() => {}} />);
    });
    const coca = tiles(tree.root).find(
      (n) => labelOf(n).startsWith("sell.grid.tileLabel") && nameOf(n) === "Coca"
    )!;
    expect(allTexts(coca)).toContain("×3");
    expect(labelOf(coca)).toContain('"count":3');
  });

  it("renders nothing when there are no tabs", () => {
    act(() => {
      tree = create(<ProductGrid tabs={[]} inCart={{}} onAdd={() => {}} />);
    });
    expect(tree.toJSON()).toBeNull();
  });
});

const isolate = (s: string) => `⁦${s}⁩`;

describe("Sell with the grid", () => {
  const render = async () => {
    await act(async () => {
      tree = create(<SellScreen />);
    });
  };

  it("on a laptop or tablet (>= 900 dp) the grid sits beside the cart, from the cached layout", async () => {
    await render();
    const names = tiles(tree.root)
      .filter((n) => labelOf(n).startsWith("sell.grid.tileLabel"))
      .map(nameOf);
    expect(names).toEqual(expect.arrayContaining(["Pain"])); // Favoris is the first tab
  });

  it("tapping a tile puts the product in the basket (the same path as a scan)", async () => {
    await render();
    const pain = tiles(tree.root).find(
      (n) => labelOf(n).startsWith("sell.grid.tileLabel") && nameOf(n) === "Pain"
    )!;
    await act(async () => pain.props.onPress());
    const texts = allTexts(tree.root);
    expect(texts.some((t) => t.includes("Pain"))).toBe(true);
    expect(texts).toContain("×1"); // the tile now carries its basket badge
  });

  it("a weighed product's tile opens the weight pad instead of adding 1 kg", async () => {
    await render();
    const tab = tree.root
      .findAll((n) => n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function")
      .find((n) => allTexts(n).some((t) => t.includes("Boulangerie")))!;
    await act(async () => tab.props.onPress());
    const kg = tiles(tree.root).find(
      (n) => labelOf(n).startsWith("sell.grid.tileLabel") && nameOf(n) === "Tomates"
    )!;
    await act(async () => kg.props.onPress());
    expect(allTexts(tree.root).join("|")).toContain("Tomates");
    expect(allTexts(tree.root)).not.toContain("×1");
  });

  it("on a phone (< 900 dp) Sell keeps its single-column layout: no grid yet", async () => {
    mockWidth = 390;
    await render();
    expect(
      tiles(tree.root).filter(
        (n) => labelOf(n).startsWith("sell.grid.tileLabel") && nameOf(n) === "Pain"
      )
    ).toHaveLength(0);
  });
});
