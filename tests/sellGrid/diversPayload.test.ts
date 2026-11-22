// A Divers line reaches record_sale with its note, through the offline queue, and nothing else changes.
import { enqueueSale, listPendingSales, type PendingSale } from "../../src/lib/sales/offlineQueue";
import { recoverSale, submitSale } from "../../src/lib/sales/queries";
import { cartLineFrom } from "../../src/lib/sales/totals";
import { pendingSaleFrom } from "../../src/lib/sales/useSaleSync";
import { diversCartLine } from "../../src/lib/sellGrid/divers";

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
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

const mockRpc = jest.fn(
  async (
    _fn: string,
    _payload: Record<string, unknown>
  ): Promise<{
    data: unknown;
    error: { message: string } | null;
    status?: number;
  }> => ({ data: null, error: null })
);
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, payload: Record<string, unknown>) => mockRpc(fn, payload),
    auth: {
      refreshSession: jest.fn(async () => ({ error: null })),
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }),
    },
  },
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({ useAuth: () => ({ session: null }) }));

const payment = {
  customer_id: null,
  payment_method: "cash" as const,
  discount_cents: 0,
  total_cents: 1700,
};
const CONFIG = { productId: "divers-id", maxCents: 20000 };
const milk = cartLineFrom({ id: "p1", name: "Milk", unit: "piece", selling_price_cents: 700 }, 1);
const divers = (cents: number, note: string | null, key: string) =>
  diversCartLine(CONFIG, { amountCents: cents, note, name: "Divers", key });

beforeEach(() => {
  mockStore.clear();
  mockRpc.mockClear();
  mockRpc.mockImplementation(async () => ({ data: null, error: null }));
});

describe("Divers in the record_sale payload", () => {
  it("sends the note of a Divers line, and a regular line keeps exactly its four fields", async () => {
    const sale = pendingSaleFrom(
      "sale-1",
      payment,
      [milk, divers(1000, "sac", "k1"), divers(500, null, "k2")],
      "user-1"
    );
    await submitSale(sale);
    const lines = mockRpc.mock.calls[0][1].p_lines as Record<string, unknown>[];
    expect(lines[0]).toEqual({
      product_id: "p1",
      quantity: 1,
      unit_price_cents: 700,
      discount_cents: 0,
    });
    expect(lines[1]).toEqual({
      product_id: "divers-id",
      quantity: 1,
      unit_price_cents: 1000,
      discount_cents: 0,
      note: "sac",
    });
    // No note typed: no note key, and the device-only fields never leave it.
    expect(lines[2]).toEqual({
      product_id: "divers-id",
      quantity: 1,
      unit_price_cents: 500,
      discount_cents: 0,
    });
    expect(JSON.stringify(lines)).not.toMatch(/key|loyalty|unit_cost|"k1"/);
  });

  it("recovery sends the note too", async () => {
    await recoverSale(pendingSaleFrom("sale-2", payment, [divers(1000, "sac", "k1")], "user-1"));
    const [fn, payload] = mockRpc.mock.calls[0];
    expect(fn).toBe("recover_sale");
    expect((payload.p_lines as Record<string, unknown>[])[0].note).toBe("sac");
  });

  it("the queue keeps the lines, notes and keys as they are, and a retry re-sends the same sale id", async () => {
    const sale = pendingSaleFrom(
      "sale-3",
      payment,
      [divers(1000, "sac", "k1"), divers(1000, "sac", "k2")],
      "user-1"
    );
    await enqueueSale(sale);
    const queued = (await listPendingSales()) as PendingSale[];
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe("sale-3");
    expect(queued[0].lines.map((l) => [l.key, l.note])).toEqual([
      ["k1", "sac"],
      ["k2", "sac"],
    ]);

    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "fetch failed" }, status: 503 });
    await expect(submitSale(queued[0])).rejects.toThrow();
    await submitSale(queued[0]);
    const ids = mockRpc.mock.calls.map((c) => c[1].p_sale_id);
    expect(new Set(ids)).toEqual(new Set(["sale-3"]));
    const lastLines = mockRpc.mock.calls.at(-1)![1].p_lines as Record<string, unknown>[];
    expect(lastLines.map((l) => l.note)).toEqual(["sac", "sac"]);
  });
});
