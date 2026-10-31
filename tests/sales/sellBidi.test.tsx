import React from "react";
import { FlatList, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { CartLineRow } from "../../src/components/sell/CartLineRow";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { isolateBidi } from "../../src/lib/text/bidi";
import { allTexts } from "./sellTestUtils";

// An Arabic name next to a Latin one: the case that flips alignment and
// reorders neighbouring numbers when the name is not isolated.
const NAME = "حليب Centrale 1L";
const product = {
  id: "milk",
  name: NAME,
  barcode: "6111234567890",
  unit: "piece",
  selling_price_cents: 700,
  current_cost_cents: null,
};

let mockSearch = "";
jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}|${options.name}` : key,
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => mockSearch }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [mockProduct()],
  fetchProductByBarcode: async () => mockProduct(),
  hasAnyProducts: async () => true,
}));
function mockProduct() {
  return {
    id: "milk",
    name: "حليب Centrale 1L",
    barcode: "6111234567890",
    unit: "piece",
    selling_price_cents: 700,
    current_cost_cents: null,
  };
}
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 0, stuck: 0, syncing: false, sync: jest.fn() }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

describe("product names are bidi-isolated in the Sell flow", () => {
  it("cart line", () => {
    act(() => {
      tree = create(
        <CartLineRow
          line={{
            product_id: "milk",
            name: NAME,
            unit: "piece",
            quantity: 1,
            unit_price_cents: 700,
            discount_cents: 0,
            unit_cost_cents: null,
          }}
          onChange={() => {}}
          onRemove={() => {}}
        />
      );
    });
    expect(allTexts(tree.root)).toContain(isolateBidi(NAME));
    expect(allTexts(tree.root)).not.toContain(NAME);
  });

  it("search results", async () => {
    mockSearch = "حليب";
    await act(async () => {
      tree = create(<SellScreen />);
    });
    expect(allTexts(tree.root)).toContain(isolateBidi(NAME));
    expect(allTexts(tree.root)).not.toContain(NAME);
    mockSearch = "";
  });

  it("the 'added' flash and the camera feed line", async () => {
    mockSearch = "";
    await act(async () => {
      tree = create(<SellScreen />);
    });
    let feed: string | null = null;
    await act(async () => {
      feed = (await tree.root.findByType(ContinuousScanner).props.onScanned("6111234567890"))
        .message;
    });

    expect(feed).toContain(isolateBidi(NAME));
    expect(allTexts(tree.root)).toContain(`sell.added|${isolateBidi(NAME)}`);
    // The cart line itself is a separate component, covered above.
    expect(tree.root.findByType(FlatList).props.data).toHaveLength(1);
    expect(tree.root.findAllByType(Text).length).toBeGreaterThan(0);
  });
});
