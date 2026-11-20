/**
 * Which devices see the camera scan button, on every screen that has one.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import StockCountScreen from "../../app/(app)/stock-in/count";
import SellScreen from "../../app/(app)/sell/index";
import { ProductForm } from "../../src/components/products/ProductForm";
import { ProductSearchPicker } from "../../src/components/stock/ProductSearchPicker";
import { cameraScanAvailable } from "../../src/lib/scanner/scanMode";

type Env = Parameters<typeof cameraScanAvailable>[0];
const PHONE: Env = {
  platform: "web",
  coarsePointer: true,
  hasGetUserMedia: true,
  secureContext: true,
};
const DESKTOP: Env = { ...PHONE, coarsePointer: false };
const NATIVE: Env = { ...DESKTOP, platform: "ios" };
let mockEnv: Env = PHONE;

// Sell imports the arrange save (it reaches Supabase); no test here saves a grid.
jest.mock("../../src/lib/sellGrid/queries", () => ({ saveGridArrangement: jest.fn() }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: object) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "fr" },
  }),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));
jest.mock("../../src/lib/scanner/scanMode", () => ({
  ...jest.requireActual("../../src/lib/scanner/scanMode"),
  useCameraScanAvailable: () =>
    jest.requireActual("../../src/lib/scanner/scanMode").cameraScanAvailable(mockEnv),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u", role: "owner" }, isOwner: true }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  getCachedGrid: async () => null,
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async () => null,
  searchCachedProducts: async () => [],
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [],
  fetchProductByBarcode: async () => null,
  hasAnyProducts: async () => true,
  createCategory: jest.fn(),
  findByBarcode: jest.fn(async () => null),
}));
jest.mock("../../src/lib/inventory/queries", () => ({ applyStockCount: jest.fn() }));
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
  pendingSaleFrom: (id: string) => ({ id }),
}));
jest.mock("../../src/lib/dialog/store", () => ({ confirm: jest.fn(), showToast: jest.fn() }));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));
jest.mock("../../src/components/products/BarcodeScannerModal", () => ({
  BarcodeScannerModal: () => null,
}));

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

const mount = async (element: React.ReactElement) => {
  await act(async () => {
    tree = create(element);
  });
};
const hasText = (label: string) =>
  tree.root.findAllByType(Text).some((n) => [n.props.children].flat().join("") === label);

const screens: [string, string, () => React.ReactElement][] = [
  ["Sell", "sell.scan", () => <SellScreen />],
  ["Count", "stockIn.countScanItems", () => <StockCountScreen />],
  [
    "product form",
    "products.formScan",
    () => <ProductForm categories={[]} submitLabel="save" onSubmit={async () => {}} />,
  ],
  [
    "product picker",
    "productPicker.scan",
    () => <ProductSearchPicker onPick={() => {}} excludeIds={[]} />,
  ],
];

describe.each(screens)("%s", (_name, label, element) => {
  it("shows the scan button on a phone", async () => {
    mockEnv = PHONE;
    await mount(element());
    expect(hasText(label)).toBe(true);
  });
  it("does not on a desktop or laptop (USB scanner)", async () => {
    mockEnv = DESKTOP;
    await mount(element());
    expect(hasText(label)).toBe(false);
  });
  it("still does in the native app", async () => {
    mockEnv = NATIVE;
    await mount(element());
    expect(hasText(label)).toBe(true);
  });
});
