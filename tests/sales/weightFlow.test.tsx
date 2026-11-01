import React from "react";
import { FlatList } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { WeightPad } from "../../src/components/sell/WeightPad";
import type { CartLine } from "../../src/lib/sales/totals";

const mockProducts: Record<string, object> = {
  kg: {
    id: "kg1",
    name: "Courgettes",
    unit: "kg",
    selling_price_cents: 900,
    current_cost_cents: null,
  },
  piece: {
    id: "p1",
    name: "Milk",
    unit: "piece",
    selling_price_cents: 700,
    current_cost_cents: null,
  },
};
let mockNext = "kg";

jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  getCachedGrid: async () => null,
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [mockProducts[mockNext]],
  // Scans use the exact-barcode lookup once it exists (see the barcode PR);
  // mocking both keeps this test independent of merge order.
  fetchProductByBarcode: async () => mockProducts[mockNext],
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 0, syncing: false, sync: jest.fn() }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));
jest.mock("../../src/components/sell/CartLineRow", () => ({ CartLineRow: () => null }));

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

async function scan(kind: "kg" | "piece") {
  mockNext = kind;
  await act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned("barcode");
  });
}

const cart = (): CartLine[] => tree.root.findByType(FlatList).props.data;
const pad = () => tree.root.findAllByType(WeightPad);
const press = (key: string) =>
  act(() => {
    tree.root.findByProps({ testID: `weight-key-${key}` }).props.onPress();
  });

beforeEach(async () => {
  await act(async () => {
    tree = create(<SellScreen />);
  });
});

it("adding a kg product opens the keypad and does NOT add a 1 kg line", async () => {
  await scan("kg");
  expect(pad()).toHaveLength(1);
  expect(cart()).toHaveLength(0);
});

it("pressing 0 . 5 then Add puts exactly 0.5 kg in the cart", async () => {
  await scan("kg");
  press("0");
  press(".");
  press("5");
  expect(tree.root.findByProps({ testID: "weight-entry" }).props.children).toBe("0.5");
  expect(tree.root.findByProps({ testID: "weight-total" }).props.children).toBe("4.50 DH");

  act(() => {
    pad()[0].props.onConfirm(0.5);
  });
  expect(pad()).toHaveLength(0);
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ product_id: "kg1", unit: "kg", quantity: 0.5 });
});

it("cancelling the keypad adds nothing", async () => {
  await scan("kg");
  act(() => {
    pad()[0].props.onCancel();
  });
  expect(pad()).toHaveLength(0);
  expect(cart()).toHaveLength(0);
});

it("weighing the same product again adds to the existing line", async () => {
  await scan("kg");
  act(() => pad()[0].props.onConfirm(0.5));
  await scan("kg");
  act(() => pad()[0].props.onConfirm(0.25));
  expect(cart()).toHaveLength(1);
  expect(cart()[0].quantity).toBe(0.75);
});

it("a piece product still adds 1 immediately, with no keypad", async () => {
  await scan("piece");
  expect(pad()).toHaveLength(0);
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ product_id: "p1", quantity: 1 });
});

it("the Add key stays disabled until the weight is above zero", async () => {
  await scan("kg");
  const add = () =>
    tree.root.findAll((node) => node.props.disabled !== undefined && node.props.onPress)[0];
  expect(add().props.disabled).toBe(true);
  press("0");
  press(".");
  expect(add().props.disabled).toBe(true);
  press("5");
  expect(add().props.disabled).toBe(false);
});
