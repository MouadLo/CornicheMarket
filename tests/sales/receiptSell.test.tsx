import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { PaymentSheet } from "../../src/components/sell/PaymentSheet";
import { ReceiptPanel } from "../../src/components/sell/ReceiptPanel";
import { enqueueSale } from "../../src/lib/sales/offlineQueue";
import { allTexts } from "./sellTestUtils";

const mockSync = jest.fn();
const mockUuid = jest.fn();
const mockT = (key: string) => key;
jest.mock("expo-crypto", () => ({ randomUUID: () => mockUuid() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier", full_name: "Sara" } }),
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
jest.mock("../../src/lib/sales/queries", () => ({
  fetchCustomers: async () => [{ id: "c1", name: "Hassan", phone: null }],
}));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 1, syncing: false, sync: mockSync }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({
    id,
    ...payment,
    lines,
    created_at: "2026-11-17T10:00:00.000Z",
  }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));
jest.mock("../../src/components/sell/CartLineRow", () => ({ CartLineRow: () => null }));

let tree: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(enqueueSale).mockResolvedValue(undefined);
  mockSync.mockResolvedValue(undefined);
  mockUuid.mockReturnValue("abcdef12-0000-0000-0000-000000000000");
});
afterEach(() => {
  act(() => tree?.unmount());
});

const hasReceiptAction = () => allTexts(tree.root).includes("receipt.action");

async function scanProduct() {
  await act(async () => {
    tree = create(<SellScreen />);
  });
  await act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned("barcode");
  });
}
const confirm = (method: string, customerId: string | null, change = 0) =>
  act(async () => {
    await tree.root.findByType(PaymentSheet).props.onConfirm(method, customerId, change);
  });

describe("receipt action on the Sell screen", () => {
  it("is absent before any sale", async () => {
    await scanProduct();
    expect(hasReceiptAction()).toBe(false);
  });

  it("appears next to the change after an accepted cash sale, and opens the receipt", async () => {
    await scanProduct();
    await confirm("cash", null, 300);
    expect(allTexts(tree.root)).toContain("sell.changeToGive");
    expect(hasReceiptAction()).toBe(true);
    const button = tree.root.findAll(
      (n) =>
        typeof n.props.onPress === "function" &&
        n.findAllByType(Text).some((x) => x.props.children === "receipt.action")
    )[0];
    await act(async () => button.props.onPress());
    const model = tree.root.findByType(ReceiptPanel).props.receipt;
    expect(model.receiptNumber).toBe("ABCDEF12");
    expect(model.totalCents).toBe(700);
    expect(model.cashierName).toBe("Sara");
    expect(model.cashReceivedCents).toBe(1000);
    expect(model.changeCents).toBe(300);
  });

  it("appears for card and credit sales, without cash details", async () => {
    await scanProduct();
    await confirm("card", null);
    expect(hasReceiptAction()).toBe(true);
    expect(allTexts(tree.root)).not.toContain("sell.changeToGive");

    await act(async () => {
      await tree.root.findByType(ContinuousScanner).props.onScanned("barcode");
    });
    expect(hasReceiptAction()).toBe(false);
    mockUuid.mockReturnValue("11111111-0000-0000-0000-000000000000");
    await confirm("credit", "c1");
    expect(hasReceiptAction()).toBe(true);
  });

  it("goes away when the next item is added", async () => {
    await scanProduct();
    await confirm("cash", null, 300);
    expect(hasReceiptAction()).toBe(true);
    await act(async () => {
      await tree.root.findByType(ContinuousScanner).props.onScanned("barcode");
    });
    expect(hasReceiptAction()).toBe(false);
  });

  it("does not appear when the sale could not be queued", async () => {
    jest.mocked(enqueueSale).mockRejectedValueOnce(new Error("queue unreadable"));
    await scanProduct();
    await confirm("cash", null, 300);
    expect(hasReceiptAction()).toBe(false);
  });

  it("does not appear for an attempt whose result is unknown", async () => {
    jest.mocked(enqueueSale).mockRejectedValueOnce(new Error("ambiguous write"));
    await scanProduct();
    await confirm("card", null);
    expect(allTexts(tree.root)).toContain("sell.attempt.title");
    expect(hasReceiptAction()).toBe(false);
  });
});
