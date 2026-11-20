import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { __resetBasketForTests } from "../../src/lib/sales/basketStore";

// handleConfirm checks the customer's debt limit again (defence in depth): a
// cashier never reaches the offline queue with a credit sale over the limit;
// the owner is not limited.
const PRODUCTS: Record<string, object> = {
  bis: {
    id: "bis",
    name: "Biscuits",
    unit: "piece",
    selling_price_cents: 4000,
    discountable: true,
  },
};

let mockRole: "owner" | "cashier" = "cashier";
let mockCustomers: object[] = [];
let mockPaymentProps: {
  onConfirm: (method: string, customerId: string | null, change: number) => Promise<void>;
  error: string | null;
};

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
  useAuth: () => ({ profile: { id: "u1", role: mockRole } }),
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
  fetchCustomers: async () => mockCustomers,
  fetchDiscountLimits: async () => ({ percent: 5, maxCents: 2000 }),
  fetchStoreCreditLimit: async () => 30000,
}));
const mockEnqueue = jest.fn(async () => {});
jest.mock("../../src/lib/sales/offlineQueue", () => ({
  enqueueSale: () => mockEnqueue(),
  listPendingSales: async () => [],
}));
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
jest.mock("../../src/components/sell/PaymentSheet", () => ({
  PaymentSheet: (props: typeof mockPaymentProps) => {
    mockPaymentProps = props;
    return null;
  },
}));

let tree: ReactTestRenderer;
beforeEach(async () => {
  mockRole = "cashier";
  mockEnqueue.mockClear();
  await __resetBasketForTests();
});
afterEach(() => act(() => tree?.unmount()));

// A basket of one 40 DH item, with the customers the server reported.
async function basket(customers: object[]) {
  mockCustomers = customers;
  await act(async () => {
    tree = create(<SellScreen />);
  });
  await act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned("bis");
  });
}
const confirm = (method: string, customerId: string | null) =>
  act(async () => {
    await mockPaymentProps.onConfirm(method, customerId, 0);
  });

describe("handleConfirm and the customer debt limit", () => {
  it("a cashier cannot queue a credit sale that would go over the limit", async () => {
    // Owes 280 DH of 300: only 20 DH left, the basket is 40 DH.
    await basket([
      { id: "c1", name: "Fatima", phone: null, balance_cents: 28000, credit_limit_cents: 30000 },
    ]);
    await confirm("credit", "c1");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockPaymentProps.error).toContain("sell.creditOver|");
    expect(mockPaymentProps.error).toContain("20.00 DH");
  });

  it("a cashier cannot queue a credit sale for a customer with no credit", async () => {
    await basket([
      { id: "c1", name: "Omar", phone: null, balance_cents: 0, credit_limit_cents: 0 },
    ]);
    await confirm("credit", "c1");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockPaymentProps.error).toBe("sell.creditNone");
  });

  it("a customer made on this device is held to the store default with a balance of 0", async () => {
    await basket([{ id: "c1", name: "Nadia", phone: null }]);
    // 40 DH <= 300 DH default
    await confirm("credit", "c1");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("a cashier can queue a credit sale within the limit", async () => {
    await basket([
      { id: "c1", name: "Fatima", phone: null, balance_cents: 26000, credit_limit_cents: 30000 },
    ]);
    await confirm("credit", "c1");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("a cashier is never blocked on cash or card", async () => {
    await basket([
      { id: "c1", name: "Omar", phone: null, balance_cents: 99000, credit_limit_cents: 0 },
    ]);
    await confirm("cash", null);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("the owner is not limited", async () => {
    mockRole = "owner";
    await basket([
      { id: "c1", name: "Omar", phone: null, balance_cents: 0, credit_limit_cents: 0 },
    ]);
    await confirm("credit", "c1");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("after a credit sale the customer owes it for the next sale's limit", async () => {
    // 260 DH owed of 300; a 40 DH sale is exactly at the limit; the next one is over.
    await basket([
      { id: "c1", name: "Fatima", phone: null, balance_cents: 26000, credit_limit_cents: 30000 },
    ]);
    await confirm("credit", "c1");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    await act(async () => {
      await tree.root.findByType(ContinuousScanner).props.onScanned("bis");
    });
    await confirm("credit", "c1");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockPaymentProps.error).toContain("sell.creditOver|");
  });
});
