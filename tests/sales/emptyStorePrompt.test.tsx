/**
 * Production starts with 0 products. A brand-new owner's first screen used
 * to be a bare "scan or search" hint with no indication of what to do
 * first. These pin the replacement: the owner sees a prompt with a way to
 * add a product or import a CSV, a cashier never does, and the normal
 * "scan or search" hint still shows once the catalog has anything in it.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { EmptyStorePrompt } from "../../src/components/sell/EmptyStorePrompt";

let mockOnline = true;
let mockHasAnyProducts: () => Promise<boolean> = async () => false;
let mockIsOwner = true;

const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u1", role: mockIsOwner ? "owner" : "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [],
  fetchProductByBarcode: async () => null,
  hasAnyProducts: () => mockHasAnyProducts(),
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: mockOnline, pending: 0, syncing: false, sync: jest.fn() }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));

let tree: ReactTestRenderer;
async function render() {
  await act(async () => {
    tree = create(<SellScreen />);
  });
  // Lets the hasAnyProducts().then(setStoreIsEmpty) microtask settle.
  await act(async () => {});
}
afterEach(() => act(() => tree.unmount()));

describe("Sell screen, empty store", () => {
  it("shows the add-product prompt to the owner when there are 0 products", async () => {
    mockIsOwner = true;
    mockOnline = true;
    mockHasAnyProducts = async () => false;
    await render();

    expect(tree.root.findAllByType(EmptyStorePrompt)).toHaveLength(1);
  });

  it("shows the normal hint once the catalog has products", async () => {
    mockIsOwner = true;
    mockOnline = true;
    mockHasAnyProducts = async () => true;
    await render();

    expect(tree.root.findAllByType(EmptyStorePrompt)).toHaveLength(0);
  });

  it("never shows the prompt to a cashier", async () => {
    mockIsOwner = false;
    mockOnline = true;
    mockHasAnyProducts = async () => false;
    await render();

    expect(tree.root.findAllByType(EmptyStorePrompt)).toHaveLength(0);
  });

  it("does not claim the store is empty while offline (unknown, not false)", async () => {
    mockIsOwner = true;
    mockOnline = false;
    mockHasAnyProducts = async () => false;
    await render();

    expect(tree.root.findAllByType(EmptyStorePrompt)).toHaveLength(0);
  });

  it("does not show the prompt when the check itself fails", async () => {
    mockIsOwner = true;
    mockOnline = true;
    mockHasAnyProducts = async () => {
      throw new Error("network error");
    };
    await render();

    expect(tree.root.findAllByType(EmptyStorePrompt)).toHaveLength(0);
  });
});
