import React from "react";
import { FlatList } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import type { CartLine } from "../../src/lib/sales/totals";

const catalog = [
  {
    id: "milk",
    name: "Milk 1L",
    barcode: "6111234567890",
    unit: "piece",
    selling_price_cents: 700,
  },
  {
    id: "pack",
    name: "Pack 6111234",
    barcode: "9990000000017",
    unit: "piece",
    selling_price_cents: 900,
  },
];

let mockOnline = true;

jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { barcode?: string; name?: string }) =>
      options?.barcode
        ? `${key}:${options.barcode}`
        : options?.name
          ? `${key}:${options.name}`
          : key,
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async (code: string) => catalog.find((p) => p.barcode === code) ?? null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  // The server search is fuzzy: name contains OR barcode starts with.
  fetchProducts: async ({ search }: { search: string }) =>
    catalog.filter((p) => p.name.includes(search) || p.barcode.startsWith(search)),
  // The exact lookup.
  fetchProductByBarcode: async (code: string) => catalog.find((p) => p.barcode === code) ?? null,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: mockOnline, pending: 0, syncing: false, sync: jest.fn() }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));
jest.mock("../../src/components/sell/CartLineRow", () => ({ CartLineRow: () => null }));

let tree: ReactTestRenderer;
beforeEach(async () => {
  mockOnline = true;
  await act(async () => {
    tree = create(<SellScreen />);
  });
});
afterEach(() => act(() => tree.unmount()));

async function scan(code: string): Promise<string | null> {
  let message: string | null = null;
  await act(async () => {
    message = (await tree.root.findByType(ContinuousScanner).props.onScanned(code)).message;
  });
  return message;
}

const cart = (): CartLine[] => tree.root.findByType(FlatList).props.data;

describe.each([
  ["online", true],
  ["offline", false],
])("barcode scan, %s", (_name, online) => {
  beforeEach(() => {
    mockOnline = online;
    act(() => tree.update(<SellScreen />));
  });

  it("adds the product on an exact barcode", async () => {
    await scan("6111234567890");
    expect(cart()).toHaveLength(1);
    expect(cart()[0].product_id).toBe("milk");
  });

  it("a partial barcode (prefix of a real one) adds nothing and says it is unknown", async () => {
    const message = await scan("611123456789");
    expect(cart()).toHaveLength(0);
    expect(message).toBe("sell.notFound:611123456789");
  });

  it("digits that appear in a product NAME do not match that product", async () => {
    const message = await scan("6111234");
    expect(cart()).toHaveLength(0);
    expect(message).toBe("sell.notFound:6111234");
  });
});
