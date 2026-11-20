import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { BigButton } from "../../src/components/BigButton";
import { CartLineRow } from "../../src/components/sell/CartLineRow";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { __resetBasketForTests } from "../../src/lib/sales/basketStore";
import type { CartLine } from "../../src/lib/sales/totals";
import { allTexts, pressableByText } from "./sellTestUtils";

// Cigarettes (60 DH) may not be discounted; the biscuits (40 DH) may.
const PRODUCTS: Record<string, object> = {
  cig: {
    id: "cig",
    name: "Cigarettes",
    unit: "piece",
    selling_price_cents: 6000,
    discountable: false,
  },
  bis: {
    id: "bis",
    name: "Biscuits",
    unit: "piece",
    selling_price_cents: 4000,
    discountable: true,
  },
};

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
  fetchProductByBarcode: async (barcode: string) => PRODUCTS[barcode] ?? null,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchCustomers: async () => [],
  fetchDiscountLimits: async () => ({ percent: 5, maxCents: 2000 }),
}));
const mockEnqueue = jest.fn(async () => {});
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: () => mockEnqueue() }));
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
beforeEach(async () => {
  mockEnqueue.mockClear();
  await __resetBasketForTests();
});
afterEach(() => act(() => tree?.unmount()));

const has = (text: string) => allTexts(tree.root).some((value) => value.includes(text));
const scan = (barcode: string) =>
  act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned(barcode);
  });
const openBasket = () =>
  act(async () => {
    tree.root
      .findAll((n) => n.props.accessibilityLabel === "sell.viewBasket" && n.props.onPress)[0]
      ?.props.onPress();
  });
const discountField = () =>
  tree.root
    .findAllByType(TextInput)
    .find((n) => n.props.accessibilityLabel === "sell.saleDiscount")!;
const charge = () =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === "sell.charge")!;

async function basketWith(...barcodes: string[]) {
  await act(async () => {
    tree = create(<SellScreen />);
  });
  for (const code of barcodes) await scan(code);
  await openBasket();
}

describe("cashier sale discount limit", () => {
  it("shows what is left of the allowance, from the items that allow a discount", async () => {
    await basketWith("cig", "bis");
    // Only once the cashier opens the discount field, not on every basket.
    expect(has("sell.saleDiscountMax|")).toBe(false);
    await act(async () => pressableByText(tree.root, "sell.saleDiscount").props.onPress());
    // 5% of 40 DH only
    expect(has("sell.saleDiscountMax|")).toBe(true);
    expect(has("2.00 DH")).toBe(true);
  });

  it("shows an error and disables Charge when the discount goes over it", async () => {
    await basketWith("cig", "bis");
    await act(async () => pressableByText(tree.root, "sell.saleDiscount").props.onPress());
    await act(async () => discountField().props.onChangeText("3"));
    expect(has("sell.saleDiscountOverLimit|")).toBe(true);
    expect(charge().props.disabled).toBe(true);

    await act(async () => discountField().props.onChangeText("2"));
    expect(has("sell.saleDiscountOverLimit")).toBe(false);
    expect(charge().props.disabled).toBe(false);
  });

  it("says the items cannot be discounted when the basket has only blocked ones", async () => {
    await basketWith("cig");
    expect(has("sell.saleDiscountNotAllowed")).toBe(true);
    expect(
      tree.root
        .findAllByType(TextInput)
        .filter((n) => n.props.accessibilityLabel === "sell.saleDiscount")
    ).toHaveLength(0);
  });
});

describe("a line that cannot be discounted", () => {
  const line: CartLine = {
    product_id: "cig",
    name: "Cigarettes",
    unit: "piece",
    quantity: 1,
    unit_price_cents: 6000,
    discount_cents: 0,
    unit_cost_cents: null,
    discountable: false,
  };
  const render = (props: { restrictDiscount: boolean; line?: CartLine }) => {
    act(() => {
      tree = create(
        <CartLineRow
          line={props.line ?? line}
          onChange={() => {}}
          onRemove={() => {}}
          restrictDiscount={props.restrictDiscount}
        />
      );
    });
    act(() => tree.root.findAllByType(require("react-native").Pressable)[0].props.onPress());
  };

  it("replaces the discount field with a short label for a cashier", () => {
    render({ restrictDiscount: true });
    expect(has("sell.noDiscountOnItem")).toBe(true);
    expect(
      tree.root
        .findAllByType(TextInput)
        .filter((n) => n.props.accessibilityLabel === "sell.discount")
    ).toHaveLength(0);
  });

  it("leaves the discount field for the owner", () => {
    render({ restrictDiscount: false });
    expect(has("sell.noDiscountOnItem")).toBe(false);
    expect(
      tree.root
        .findAllByType(TextInput)
        .filter((n) => n.props.accessibilityLabel === "sell.discount")
    ).toHaveLength(1);
  });
});
