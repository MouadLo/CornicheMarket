import {
  clearQueue,
  countPendingSales,
  enqueueSale,
  listPendingSales,
  markAttempt,
  removePendingSale,
  type PendingSale,
} from "../../src/lib/sales/offlineQueue";

// Prefixed with "mock" because jest hoists the factory above this declaration.
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

function pending(id: string): PendingSale {
  return {
    id,
    customer_id: null,
    payment_method: "cash",
    discount_cents: 0,
    total_cents: 700,
    lines: [],
    created_at: new Date().toISOString(),
    attempts: 0,
  };
}

beforeEach(() => {
  mockStore.clear();
});

describe("offline sale queue", () => {
  it("starts empty", async () => {
    expect(await listPendingSales()).toEqual([]);
    expect(await countPendingSales()).toBe(0);
  });

  it("queues a sale and reads it back", async () => {
    await enqueueSale(pending("sale-1"));
    const queue = await listPendingSales();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("sale-1");
  });

  it("keeps sales in the order they were made", async () => {
    await enqueueSale(pending("sale-1"));
    await enqueueSale(pending("sale-2"));
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["sale-1", "sale-2"]);
  });

  it("never queues the same sale twice", async () => {
    await enqueueSale(pending("sale-1"));
    await enqueueSale(pending("sale-1"));
    expect(await countPendingSales()).toBe(1);
  });

  it("removes a sale once it has synced", async () => {
    await enqueueSale(pending("sale-1"));
    await enqueueSale(pending("sale-2"));
    await removePendingSale("sale-1");
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["sale-2"]);
  });

  it("ignores removal of something not queued", async () => {
    await enqueueSale(pending("sale-1"));
    await removePendingSale("nope");
    expect(await countPendingSales()).toBe(1);
  });

  it("records a failed attempt without losing the sale", async () => {
    await enqueueSale(pending("sale-1"));
    await markAttempt("sale-1", "network down");

    const [sale] = await listPendingSales();
    expect(sale.attempts).toBe(1);
    expect(sale.last_error).toBe("network down");
    expect(await countPendingSales()).toBe(1);
  });

  it("counts attempts across retries", async () => {
    await enqueueSale(pending("sale-1"));
    await markAttempt("sale-1", "first");
    await markAttempt("sale-1", "second");

    const [sale] = await listPendingSales();
    expect(sale.attempts).toBe(2);
    expect(sale.last_error).toBe("second");
  });

  it("survives a corrupt queue rather than throwing", async () => {
    mockStore.set("corniche.pendingSales.v1", "{not json");
    expect(await listPendingSales()).toEqual([]);
  });

  it("clears everything", async () => {
    await enqueueSale(pending("sale-1"));
    await clearQueue();
    expect(await countPendingSales()).toBe(0);
  });
});
