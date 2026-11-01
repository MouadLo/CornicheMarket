/**
 * Found live: when saving a sale failed, the next tap on "Complete sale" (after
 * any change to the basket) showed hardcoded English, "The previous sale may
 * already be saved. Restore the original basket and payment before retrying.",
 * and the cashier could neither see that attempt, nor abandon it, nor sell.
 *
 * Now the cashier sees what the unconfirmed attempt was (amount, method) and can
 * retry it, check the sales history, or discard it and start a new sale (new
 * sale id, behind an explicit confirmation).
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { PaymentSheet } from "../../src/components/sell/PaymentSheet";
import { PendingAttemptCard } from "../../src/components/sell/PendingAttemptCard";
import { enqueueSale } from "../../src/lib/sales/offlineQueue";
import { allTexts, hardcodedTexts, keyEcho, pressableByText } from "./sellTestUtils";

const mockSync = jest.fn();
const mockUuid = jest.fn();
const mockConfirm = jest.fn();
const mockPush = jest.fn();
// What the lookup returns. The offline cache's products have no cost field at all.
let mockProduct: Record<string, unknown> = {};
const mockT = (key: string, options?: object) =>
  options ? `${keyEcho(key)}${JSON.stringify(options)}` : keyEcho(key);
jest.mock("expo-crypto", () => ({ randomUUID: () => mockUuid() }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("../../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
  showToast: jest.fn(),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [],
  fetchProductByBarcode: async () => mockProduct,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 0, syncing: false, sync: mockSync }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[], cashier: string) => ({
    id,
    ...payment,
    lines,
    created_at: "2026-11-01T10:00:00.000Z",
    attempts: 0,
    cashier_id: cashier,
  }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));
jest.mock("../../src/components/sell/CartLineRow", () => ({ CartLineRow: () => null }));

let tree: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockSync.mockResolvedValue(undefined);
  mockConfirm.mockResolvedValue(true);
  mockProduct = {
    id: "p1",
    name: "Milk",
    unit: "piece",
    selling_price_cents: 700,
    current_cost_cents: null,
  };
  let n = 0;
  mockUuid.mockImplementation(() => (n++ === 0 ? "original-id" : `new-id-${n}`));
});
afterEach(() => {
  act(() => tree?.unmount());
});

const scan = () =>
  act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned("barcode");
  });
const confirmSale = (method = "cash") =>
  act(async () => {
    await tree.root.findByType(PaymentSheet).props.onConfirm(method, null);
  });
const card = () => tree.root.findAllByType(PendingAttemptCard);

// The failure the live repro hit: the first save fails, then the basket changes.
async function failThenChangeBasket() {
  jest.mocked(enqueueSale).mockRejectedValueOnce(new Error("Invalid sales storage"));
  await act(async () => {
    tree = create(<SellScreen />);
  });
  await scan();
  await confirmSale();
  await scan(); // 2 x Milk: the basket no longer matches the attempt
  await confirmSale();
}

it("a failed save shows a translated message, not the technical one", async () => {
  jest.mocked(enqueueSale).mockRejectedValueOnce(new Error("Invalid sales storage"));
  await act(async () => {
    tree = create(<SellScreen />);
  });
  await scan();
  await confirmSale();
  expect(tree.root.findByType(PaymentSheet).props.error).toBe("⟦sell.couldNotRecord⟧");
});

it("a product from the offline cache (no cost field) becomes a line with a null cost", async () => {
  delete mockProduct.current_cost_cents;
  jest.mocked(enqueueSale).mockResolvedValue(undefined);
  await act(async () => {
    tree = create(<SellScreen />);
  });
  await scan();
  await confirmSale();
  const [sale] = jest.mocked(enqueueSale).mock.calls[0];
  expect(sale.lines[0].unit_cost_cents).toBeNull();
});

describe("after a failed save and a changed basket", () => {
  beforeEach(() => jest.mocked(enqueueSale).mockResolvedValue(undefined));

  it("no hardcoded English; the sheet shows no dead-end message", async () => {
    await failThenChangeBasket();
    expect(String(tree.root.findByType(PaymentSheet).props.error ?? "")).not.toMatch(/previous/i);
    expect(hardcodedTexts(tree.root)).toEqual([]);
  });

  it("shows what the unconfirmed attempt was: amount and payment method", async () => {
    await failThenChangeBasket();
    expect(card()).toHaveLength(1);
    const texts = allTexts(card()[0]).join(" ");
    expect(texts).toContain("sell.attempt.title");
    expect(texts).toContain("7.00");
    expect(texts).toContain("sell.paymentCash");
  });

  it("offers the sales history", async () => {
    await failThenChangeBasket();
    act(() => pressableByText(card()[0], "⟦sell.attempt.history⟧").props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/sell/history");
  });

  it("discard asks first, with a danger confirmation that says it may already be recorded", async () => {
    await failThenChangeBasket();
    await act(async () => {
      await pressableByText(card()[0], "⟦sell.attempt.discard⟧").props.onPress();
    });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "danger",
        title: "⟦sell.attempt.discardTitle⟧",
        message: "⟦sell.attempt.discardMessage⟧",
      })
    );
  });

  it("declining the confirmation changes nothing", async () => {
    await failThenChangeBasket();
    mockConfirm.mockResolvedValue(false);
    await act(async () => {
      await pressableByText(card()[0], "⟦sell.attempt.discard⟧").props.onPress();
    });
    expect(card()).toHaveLength(1);
  });

  it("confirming discards the attempt: the next sale gets a NEW id and goes through", async () => {
    await failThenChangeBasket();
    await act(async () => {
      await pressableByText(card()[0], "⟦sell.attempt.discard⟧").props.onPress();
    });
    expect(card()).toHaveLength(0);
    await confirmSale();
    const ids = jest.mocked(enqueueSale).mock.calls.map(([s]) => s.id);
    expect(ids[0]).toBe("original-id"); // the failed attempt
    expect(ids[ids.length - 1]).not.toBe("original-id");
    expect(ids[ids.length - 1]).toMatch(/^new-id/);
  });

  it("retry saves the ORIGINAL attempt (same id) and leaves the changed basket alone", async () => {
    await failThenChangeBasket();
    jest.mocked(enqueueSale).mockClear();
    await act(async () => {
      await pressableByText(card()[0], "⟦sell.attempt.retry⟧").props.onPress();
    });
    expect(enqueueSale).toHaveBeenCalledTimes(1);
    expect(jest.mocked(enqueueSale).mock.calls[0][0]).toMatchObject({
      id: "original-id",
      total_cents: 700,
    });
    expect(card()).toHaveLength(0);
    expect(tree.root.findByType(PaymentSheet).props.totalCents).toBe(1400); // basket kept
  });

  it("a failed retry keeps the card and the same attempt", async () => {
    await failThenChangeBasket();
    jest.mocked(enqueueSale).mockRejectedValueOnce(new Error("still broken"));
    await act(async () => {
      await pressableByText(card()[0], "⟦sell.attempt.retry⟧").props.onPress();
    });
    expect(card()).toHaveLength(1);
  });
});
