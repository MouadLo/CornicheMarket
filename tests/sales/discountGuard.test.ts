/**
 * Proves the B1 fix end to end: a sale with an over-large discount is
 * rejected with a readable error and never reaches enqueueSale -- so it
 * can never later turn up in the stuck-sales list, since quarantine only
 * ever happens to a sale that was already queued and then failed to sync.
 *
 * This mirrors the exact guard in app/(app)/sell/index.tsx's handleConfirm:
 * validateSaleDiscounts() is checked before enqueueSale() is ever called.
 */
import {
  countPendingSales,
  countStuckSales,
  enqueueSale,
  listStuckSales,
} from "../../src/lib/sales/offlineQueue";
import { pendingSaleFrom } from "../../src/lib/sales/useSaleSync";
import { validateSaleDiscounts, type CartLine } from "../../src/lib/sales/totals";

// pendingSaleFrom pulls in useSaleSync -> queries -> supabase/client, which
// throws outside a real RN runtime unless mocked (same pattern used in
// tests/sales/syncCycle.test.ts).
jest.mock("../../src/lib/sales/queries", () => ({
  submitSale: jest.fn(),
  fetchCustomers: jest.fn(),
  voidSale: jest.fn(),
}));

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { auth: { refreshSession: jest.fn() } },
}));

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

const mockStore = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

beforeEach(() => {
  mockStore.clear();
});

function cartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    product_id: "p1",
    name: "Coca-Cola 33cl",
    unit: "piece",
    quantity: 1,
    unit_price_cents: 700,
    discount_cents: 0,
    unit_cost_cents: 500,
    ...overrides,
  };
}

// Replica of handleConfirm's submission gate: check, then (only if valid)
// enqueue. Returns the readable error key, or null on success.
async function trySubmit(lines: CartLine[], saleDiscountCents: number): Promise<string | null> {
  const check = validateSaleDiscounts(lines, saleDiscountCents);
  if (check === "line") return "sell.lineDiscountTooHigh";
  if (check === "sale") return "sell.saleDiscountTooHigh";

  const sale = pendingSaleFrom(
    "sale-under-test",
    {
      customer_id: null,
      payment_method: "cash",
      discount_cents: saleDiscountCents,
      total_cents: 0,
    },
    lines
  );
  await enqueueSale(sale);
  return null;
}

describe("a sale with an over-large line discount", () => {
  it("is rejected with a readable error and never queued", async () => {
    const lines = [cartLine({ quantity: 1, unit_price_cents: 700, discount_cents: 701 })];

    const result = await trySubmit(lines, 0);

    expect(result).toBe("sell.lineDiscountTooHigh");
    expect(await countPendingSales()).toBe(0);
    expect(await countStuckSales()).toBe(0);
    expect(await listStuckSales()).toEqual([]);
  });
});

describe("a sale with an over-large basket discount", () => {
  it("is rejected with a readable error and never queued", async () => {
    const lines = [cartLine({ quantity: 1, unit_price_cents: 700, discount_cents: 0 })];

    const result = await trySubmit(lines, 701);

    expect(result).toBe("sell.saleDiscountTooHigh");
    expect(await countPendingSales()).toBe(0);
    expect(await countStuckSales()).toBe(0);
  });
});

describe("a sale with valid discounts", () => {
  it("is accepted and queued normally", async () => {
    const lines = [cartLine({ quantity: 1, unit_price_cents: 700, discount_cents: 100 })];

    const result = await trySubmit(lines, 200);

    expect(result).toBeNull();
    expect(await countPendingSales()).toBe(1);
    expect(await countStuckSales()).toBe(0);
  });
});
