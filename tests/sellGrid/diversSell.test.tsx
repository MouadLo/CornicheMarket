// The Divers ("Montant libre") flow on the real Sell screen: tile, pad, basket.
import React from "react";
import { Dimensions } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { __resetBasketForTests } from "../../src/lib/sales/basketStore";
import { allTexts } from "../sales/sellTestUtils";

let mockRole = "cashier";
let mockUuid = 0;
let mockDivers: { productId: string; maxCents: number } | null = {
  productId: "divers-id",
  maxCents: 20000,
};

jest.mock(
  "../../src/lib/loyalty/queries",
  () => require("../fixtures/loyaltyQueriesMock").loyaltyQueriesMock
);
jest.mock("../../src/lib/sellGrid/queries", () => ({ saveGridArrangement: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuid}` }));
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
  useAuth: () => ({ profile: { id: "u1", role: mockRole } }),
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
    categories: [{ id: "c1", name: "Boissons" }],
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
    ],
    tiles: [],
    divers: mockDivers,
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
        low_stock_threshold: 2,
      },
    ],
  }),
}));

let tree: ReactTestRenderer;
beforeEach(() => {
  mockRole = "cashier";
  mockUuid = 0;
  mockDivers = { productId: "divers-id", maxCents: 20000 };
  jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: 1366, height: 768, scale: 1, fontScale: 1 }));
});
afterEach(async () => {
  act(() => tree?.unmount());
  await __resetBasketForTests();
  jest.restoreAllMocks();
});

const render = async () => {
  await act(async () => {
    tree = create(<SellScreen />);
  });
};
// A Pressable shows up as several nested nodes carrying the same testID: keep the outermost.
const byId = (testID: string) =>
  tree.root
    .findAllByProps({ testID })
    .filter((n) => n.parent?.props.testID !== testID && typeof n.props.onPress === "function");
const tile = () => byId("divers-tile");
const key = (k: string) => tree.root.findByProps({ testID: `divers-key-${k}` });
const type = async (keys: string) => {
  for (const k of keys) await act(async () => key(k).props.onPress());
};
const addButton = (): ReactTestInstance =>
  tree.root
    .findAll((n) => typeof n.props.onPress === "function" && "disabled" in n.props)
    .find((n) => allTexts(n).includes("common.add"))!;
const note = (text: string) =>
  act(async () => {
    tree.root.findByProps({ testID: "divers-note" }).props.onChangeText(text);
  });
const addDivers = async (amount: string, noteText?: string) => {
  await act(async () => tile()[0].props.onPress());
  await type(amount);
  if (noteText) await note(noteText);
  await act(async () => addButton().props.onPress());
};
const removeButtons = () => byId("divers-remove");

describe("Sell: Montant libre", () => {
  it("offers the tile, and opens the pad on tap", async () => {
    await render();
    expect(tile()).toHaveLength(1);
    expect(tree.root.findAllByProps({ testID: "divers-key-1" })).toHaveLength(0);
    await act(async () => tile()[0].props.onPress());
    expect(tree.root.findAllByProps({ testID: "divers-key-1" }).length).toBeGreaterThan(0);
  });

  it("hides the tile when the device does not know the Divers product", async () => {
    mockDivers = null;
    await render();
    expect(tile()).toHaveLength(0);
  });

  it("adds a Divers line with its note, quantity 1, and shows Divers, the note and a remove button", async () => {
    await render();
    await addDivers("12.5", "sac");
    const texts = allTexts(tree.root).join("|");
    expect(texts).toContain("sell.diversName");
    expect(texts).toContain("sac");
    expect(texts).toContain("12.50 DH");
    expect(removeButtons()).toHaveLength(1);
    // The pad closed and the tile counts the line.
    expect(tree.root.findAllByProps({ testID: "divers-key-1" })).toHaveLength(0);
    expect(allTexts(tree.root.findByProps({ testID: "divers-qty-badge" }))).toEqual(["×1"]);
  });

  it("two Divers lines stay two lines, each with its own note, and one can be removed alone", async () => {
    await render();
    await addDivers("5", "sac");
    await addDivers("5", "recharge");
    expect(removeButtons()).toHaveLength(2);
    const texts = allTexts(tree.root);
    expect(texts).toContain("⁨sac⁩");
    expect(texts).toContain("⁨recharge⁩");

    await act(async () => removeButtons()[0].props.onPress());
    expect(removeButtons()).toHaveLength(1);
    expect(allTexts(tree.root)).toContain("⁨recharge⁩");
    expect(allTexts(tree.root)).not.toContain("⁨sac⁩");
  });

  it("a cashier cannot add over the maximum; the owner can", async () => {
    await render();
    await act(async () => tile()[0].props.onPress());
    await type("500");
    expect(addButton().props.disabled).toBe(true);
    act(() => tree.unmount());

    mockRole = "owner";
    await render();
    await act(async () => tile()[0].props.onPress());
    await type("500");
    expect(addButton().props.disabled).toBe(false);
    await act(async () => addButton().props.onPress());
    expect(allTexts(tree.root).join("|")).toContain("500.00 DH");
  });
});
