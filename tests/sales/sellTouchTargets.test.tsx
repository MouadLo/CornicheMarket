import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { CartLineRow } from "../../src/components/sell/CartLineRow";
import { PaymentSheet } from "../../src/components/sell/PaymentSheet";
import { pressableByText, sizeOf } from "./sellTestUtils";

const MIN = 48;

jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "owner", role: "owner" } }),
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
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn() }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: true, pending: 0, stuck: 2, syncing: false, sync: jest.fn() }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({
  PaymentSheet: jest.requireActual("../../src/components/sell/PaymentSheet").PaymentSheet,
}));

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

describe("touch targets are at least 48dp", () => {
  it("Sell header link: Ventes", async () => {
    await act(async () => {
      tree = create(<SellScreen />);
    });
    const size = sizeOf(pressableByText(tree.root, "sell.history"));
    expect(size.minHeight).toBeGreaterThanOrEqual(MIN);
  });

  it("Crédit and the stuck-sales banner left Sell: the shell owns them now", async () => {
    await act(async () => {
      tree = create(<SellScreen />);
    });
    const texts = tree.root
      .findAll((n) => (n.type as unknown) === "Text")
      .map((n) => n.children.join(""));
    expect(texts).not.toContain("sell.credit");
    expect(texts).not.toContain("sell.stuckBanner");
  });

  it("Retirer (remove line), for piece and weighed lines", () => {
    const line = {
      product_id: "p1",
      name: "Milk",
      unit: "piece",
      quantity: 1,
      unit_price_cents: 700,
      discount_cents: 0,
      unit_cost_cents: null,
    };
    for (const unit of ["piece", "kg"]) {
      act(() => {
        tree = create(
          <CartLineRow line={{ ...line, unit }} onChange={() => {}} onRemove={() => {}} />
        );
      });
      const size = sizeOf(pressableByText(tree.root, "sell.remove"));
      expect(size.minHeight).toBeGreaterThanOrEqual(MIN);
      expect(size.minWidth).toBeGreaterThanOrEqual(MIN);
      act(() => tree.unmount());
    }
  });

  it("payment sheet: quick cash amounts and customer chips", () => {
    act(() => {
      tree = create(
        <PaymentSheet
          visible
          totalCents={800}
          customers={[{ id: "c1", name: "Fatima Zahra", phone: null }]}
          saving={false}
          error={null}
          onClose={() => {}}
          onConfirm={() => {}}
          onCreateCustomer={async () => null}
        />
      );
    });
    expect(sizeOf(pressableByText(tree.root, "20.00")).minHeight).toBeGreaterThanOrEqual(MIN);

    act(() => pressableByText(tree.root, "sell.payLater").props.onPress());
    expect(sizeOf(pressableByText(tree.root, "Fatima Zahra")).minHeight).toBeGreaterThanOrEqual(
      MIN
    );
  });
});
