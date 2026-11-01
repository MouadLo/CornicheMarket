import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { PaymentSheet } from "../../src/components/sell/PaymentSheet";
import { enqueueSale } from "../../src/lib/sales/offlineQueue";

const mockSync = jest.fn();
const mockUuid = jest.fn();
const mockT = (key: string) => key;
jest.mock("expo-crypto", () => ({ randomUUID: () => mockUuid() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
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
  fetchProducts: async () => [],
  fetchProductByBarcode: async () => ({
    id: "p1",
    name: "Milk",
    unit: "piece",
    selling_price_cents: 700,
    current_cost_cents: null,
  }),
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 1, syncing: false, sync: mockSync }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));
jest.mock("../../src/components/sell/CartLineRow", () => ({ CartLineRow: () => null }));

let tree: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(enqueueSale).mockResolvedValue(undefined);
  mockUuid.mockReturnValue("original-sale-id");
});
afterEach(() => {
  act(() => tree?.unmount());
});

async function scanProduct() {
  await act(async () => {
    tree = create(<SellScreen />);
  });
  await act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned("barcode");
  });
}

it("accepts locally once, clears the basket, and does not duplicate after sync rejects", async () => {
  mockSync.mockRejectedValue(new Error("storage unavailable during sync"));
  await scanProduct();
  await act(async () => {
    const confirm = tree.root.findByType(PaymentSheet).props.onConfirm;
    await Promise.all([confirm("cash", null), confirm("cash", null)]);
  });
  expect(enqueueSale).toHaveBeenCalledTimes(1);
  expect(mockUuid).toHaveBeenCalledTimes(1);
  expect(jest.mocked(enqueueSale).mock.calls[0][0].id).toBe("original-sale-id");
  expect(mockSync).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(PaymentSheet).props.totalCents).toBe(0);
  expect(tree.root.findByType(PaymentSheet).props.error).toBeNull();
  await act(async () => {
    await tree.root.findByType(PaymentSheet).props.onConfirm("cash", null);
  });
  expect(enqueueSale).toHaveBeenCalledTimes(1);
});

it("clears an accepted basket before a slow sync completes", async () => {
  let finish!: () => void;
  mockSync.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await scanProduct();
  await act(async () => {
    await tree.root.findByType(PaymentSheet).props.onConfirm("cash", null);
  });
  expect(tree.root.findByType(PaymentSheet).props.totalCents).toBe(0);
  expect(tree.root.findByType(PaymentSheet).props.saving).toBe(false);
  await act(async () => {
    finish();
  });
});

it("retains the basket and reports a failed enqueue without attempting sync", async () => {
  jest.mocked(enqueueSale).mockRejectedValueOnce(new Error("queue unreadable"));
  await scanProduct();
  await act(async () => {
    await tree.root.findByType(PaymentSheet).props.onConfirm("cash", null);
  });
  expect(tree.root.findByType(PaymentSheet).props.totalCents).toBe(700);
  expect(tree.root.findByType(PaymentSheet).props.error).toBe("sell.couldNotRecord");
  expect(mockSync).not.toHaveBeenCalled();
});

it("reuses the same sale id if the storage write persisted but its acknowledgement failed", async () => {
  let persisted: unknown;
  jest
    .mocked(enqueueSale)
    .mockImplementationOnce(async (sale) => {
      persisted = sale;
      throw new Error("ambiguous write");
    })
    .mockResolvedValueOnce(undefined);
  mockUuid.mockReturnValueOnce("original-sale-id").mockReturnValueOnce("different-id");
  mockSync.mockResolvedValue(undefined);
  await scanProduct();
  await act(async () => {
    await tree.root.findByType(PaymentSheet).props.onConfirm("cash", null);
  });
  expect(persisted).toBeDefined();
  await act(async () => {
    await tree.root.findByType(PaymentSheet).props.onConfirm("cash", null);
  });
  expect(jest.mocked(enqueueSale).mock.calls.map(([sale]) => sale.id)).toEqual([
    "original-sale-id",
    "original-sale-id",
  ]);
  expect(mockUuid).toHaveBeenCalledTimes(1);
  expect(mockSync).toHaveBeenCalledTimes(1);
});
