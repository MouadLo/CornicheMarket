import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { CartLineRow } from "../../src/components/sell/CartLineRow";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { __resetBasketForTests } from "../../src/lib/sales/basketStore";
import {
  __resetForTests as resetDialogs,
  getState,
  registerHost,
  resolveConfirm,
} from "../../src/lib/dialog/store";
import { allTexts, pressableByText } from "./sellTestUtils";

// Products the device "knows" (the offline cache) and what the server would add.
const COCA = {
  id: "coca",
  name: "Coca-Cola 33cl",
  barcode: "611100",
  unit: "piece",
  selling_price_cents: 700,
};
const BARRE = {
  id: "barre",
  name: "Barre chocolatee",
  barcode: null,
  unit: "piece",
  selling_price_cents: 450,
};
const LAIT = {
  id: "lait",
  name: "Lait Centrale 1L",
  barcode: null,
  unit: "piece",
  selling_price_cents: 1200,
};
const CACHE = [BARRE, COCA, LAIT];

let mockDebounced = "";
let mockServer: unknown[] = [];
const mockSearchCached = jest.fn(async (term: string) =>
  CACHE.filter((p) => p.name.toLowerCase().includes(term.toLowerCase()))
);

jest.mock(
  "../../src/lib/loyalty/queries",
  () => require("../fixtures/loyaltyQueriesMock").loyaltyQueriesMock
);
// Sell imports the arrange save (it reaches Supabase); no test here saves a grid.
jest.mock("../../src/lib/sellGrid/queries", () => ({ saveGridArrangement: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => mockDebounced }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  getCachedGrid: async () => null,
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async () => null,
  searchCachedProducts: (term: string) => mockSearchCached(term),
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => mockServer,
  fetchProductByBarcode: async (barcode: string) =>
    barcode === "611100"
      ? { id: "coca", name: "Coca-Cola 33cl", barcode, unit: "piece", selling_price_cents: 700 }
      : barcode === "222"
        ? {
            id: "lait",
            name: "Lait Centrale 1L",
            barcode,
            unit: "piece",
            selling_price_cents: 1200,
          }
        : null,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn(async () => {}) }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({
    online: true,
    pending: 0,
    stuck: 0,
    syncing: false,
    sync: jest.fn(async () => {}),
  }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));

let tree: ReactTestRenderer;
let unregister: () => void;
beforeEach(async () => {
  mockDebounced = "";
  mockServer = [];
  resetDialogs();
  unregister = registerHost();
  await __resetBasketForTests();
});
afterEach(() => {
  act(() => tree?.unmount());
  unregister();
});

async function open() {
  await act(async () => {
    tree = create(<SellScreen />);
  });
}
const scan = (barcode: string) =>
  act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned(barcode);
  });
// On a phone the basket is behind the bottom bar.
const openBasket = () =>
  act(async () => {
    tree.root
      .findAll(
        (node) => node.props.accessibilityLabel === "sell.viewBasket" && node.props.onPress
      )[0]
      ?.props.onPress();
  });
const rows = () => tree.root.findAllByType(CartLineRow).map((row) => row.props.line.name as string);
const has = (text: string) => allTexts(tree.root).some((value) => value.includes(text));
const press = (label: string) => act(() => pressableByText(tree.root, label).props.onPress());
const toast = () => getState().toast;
const undo = () => act(() => toast()!.action!.onPress());
// Answer the open confirmation dialog.
const answer = async (value: boolean) => {
  const request = getState().confirm!;
  await act(async () => {
    resolveConfirm(request.id, value);
  });
};
const qtyTexts = () => allTexts(tree.root).filter((value) => /^[0-9]$/.test(value));
const discountBox = () =>
  tree.root.findAllByType(TextInput).find((node) => node.props.placeholder === "0.00");

describe("Empty basket (UX C11)", () => {
  it("is only offered when the basket has lines", async () => {
    await open();
    expect(has("sell.emptyBasket")).toBe(false);
    await scan("611100");
    await openBasket();
    expect(has("sell.emptyBasket")).toBe(true);
  });

  it("asks first and changes nothing on no", async () => {
    await open();
    await scan("611100");
    await openBasket();
    await press("sell.emptyBasket");
    expect(getState().confirm?.tone).toBe("danger");
    await answer(false);
    expect(rows().some((n) => n.includes("Coca"))).toBe(true);
    expect(toast()).toBeNull();
  });

  it("clears the lines on yes and Undo brings them back", async () => {
    await open();
    await scan("611100");
    await scan("222");
    await openBasket();
    await press("sell.emptyBasket");
    await answer(true);
    expect(rows().some((n) => n.includes("Coca"))).toBe(false);
    expect(rows().some((n) => n.includes("Lait"))).toBe(false);
    expect(toast()?.text).toBe("sell.basketEmptied");
    await undo();
    expect(rows().some((n) => n.includes("Coca"))).toBe(true);
    expect(rows().some((n) => n.includes("Lait"))).toBe(true);
  });

  it("also clears the sale discount, and Undo restores it", async () => {
    await open();
    await scan("611100");
    await openBasket();
    await press("sell.saleDiscount");
    await act(async () => discountBox()!.props.onChangeText("2"));
    await press("sell.emptyBasket");
    await answer(true);
    expect(discountBox()).toBeUndefined();
    // A new basket starts without the old discount; Undo brings both back.
    await undo();
    await openBasket();
    expect(discountBox()?.props.value).toBe("2");
  });
});

describe("Undo after removing a line (UX C11)", () => {
  it("Remove shows a toast and Undo puts the line back where it was", async () => {
    await open();
    await scan("611100");
    await scan("222");
    await openBasket();
    const names = rows;
    expect(names()[0]).toContain("Coca");
    const row = tree.root.findAllByType(CartLineRow)[0];
    await act(async () => row.props.onRemove());
    expect(rows().some((n) => n.includes("Coca"))).toBe(false);
    expect(toast()?.text).toContain("sell.lineRemoved");
    expect(toast()?.action?.label).toBe("common.undo");
    await undo();
    expect(names()[0]).toContain("Coca");
  });

  it("stepping the quantity to zero also offers Undo", async () => {
    await open();
    await scan("611100");
    await openBasket();
    await press("−");
    expect(rows().some((n) => n.includes("Coca"))).toBe(false);
    expect(toast()?.action).toBeDefined();
    await undo();
    expect(rows().some((n) => n.includes("Coca"))).toBe(true);
    expect(qtyTexts()).toContain("1");
  });

  it("does not duplicate a line that was added again meanwhile", async () => {
    await open();
    await scan("611100");
    await openBasket();
    await press("−");
    await scan("611100");
    await openBasket();
    await undo();
    expect(tree.root.findAllByType(CartLineRow)).toHaveLength(1);
  });
});
