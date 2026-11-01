import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearQueue,
  dismissStuckSale,
  exportRawSalesStorage,
  listStuckSales,
  quarantineSale,
  retryStuckSale,
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

  it("reports corrupt data without overwriting it", async () => {
    mockStore.set("corniche.pendingSales.v1", "{not json");
    await expect(listPendingSales()).rejects.toThrow("Original data preserved");
  });

  it("clears everything", async () => {
    await enqueueSale(pending("sale-1"));
    await clearQueue();
    expect(await countPendingSales()).toBe(0);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const pendingKey = "corniche.pendingSales.v1";
const stuckKey = "corniche.stuckSales.v1";

describe("serialized sales storage", () => {
  it("preserves simultaneous enqueues while the first read is paused", async () => {
    const entered = deferred<void>();
    const read = deferred<string | null>();
    jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => {
      entered.resolve();
      return read.promise;
    });
    const first = enqueueSale(pending("A"));
    await entered.promise;
    const second = enqueueSale(pending("B"));
    read.resolve(null);
    await Promise.all([first, second]);
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["A", "B"]);
  });

  it("preserves an enqueue overlapping removal", async () => {
    await enqueueSale(pending("A"));
    await Promise.all([enqueueSale(pending("B")), removePendingSale("A")]);
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["B"]);
  });

  it("serializes retry, quarantine and dismiss without losing unrelated sales", async () => {
    await enqueueSale(pending("A"));
    await enqueueSale(pending("B"));
    await quarantineSale(pending("A"), "invalid");
    await Promise.all([
      retryStuckSale("A"),
      quarantineSale(pending("B"), "invalid"),
      enqueueSale(pending("C")),
      dismissStuckSale("not-present"),
    ]);
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["A", "C"]);
    expect((await listStuckSales()).map((entry) => entry.sale.id)).toEqual(["B"]);
  });

  it("propagates failed reads without changing existing bytes", async () => {
    await enqueueSale(pending("A"));
    const original = mockStore.get(pendingKey);
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error("read failed"));
    await expect(enqueueSale(pending("B"))).rejects.toThrow("read failed");
    expect(mockStore.get(pendingKey)).toBe(original);
    await enqueueSale(pending("C"));
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["A", "C"]);
  });

  it.each(["", "{broken", "{}", "null"])(
    "preserves invalid raw pending data %s and allows raw recovery export",
    async (raw) => {
      mockStore.set(pendingKey, raw);
      await expect(enqueueSale(pending("B"))).rejects.toThrow("Original data preserved");
      await expect(clearQueue()).rejects.toThrow();
      expect(await exportRawSalesStorage()).toEqual({
        pending: raw,
        stuck: null,
        unreadable: null,
      });
    }
  );

  it("does not modify pending data when the stuck destination is corrupt", async () => {
    await enqueueSale(pending("A"));
    mockStore.set(stuckKey, "{broken");
    await expect(quarantineSale(pending("A"), "invalid")).rejects.toThrow();
    await expect(dismissStuckSale("A")).rejects.toThrow();
    await expect(retryStuckSale("A")).rejects.toThrow();
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["A"]);
    expect(mockStore.get(stuckKey)).toBe("{broken");
  });

  it("a failed write rejects only that operation, not the next enqueue", async () => {
    await enqueueSale(pending("A"));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));
    const failed = enqueueSale(pending("B"));
    const next = enqueueSale(pending("C"));
    await expect(failed).rejects.toThrow("disk full");
    await next;
    expect((await listPendingSales()).map((sale) => sale.id)).toEqual(["A", "C"]);
  });

  it("failed quarantine source removal leaves both recoverable copies", async () => {
    await enqueueSale(pending("A"));
    jest
      .mocked(AsyncStorage.setItem)
      .mockImplementationOnce(async (key, value) => {
        mockStore.set(key, value);
      })
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(quarantineSale(pending("A"), "invalid")).rejects.toThrow("write failed");
    expect((await listPendingSales())[0].id).toBe("A");
    expect((await listStuckSales())[0].sale.id).toBe("A");
    await quarantineSale(pending("A"), "invalid");
    expect(await listPendingSales()).toEqual([]);
    expect(await listStuckSales()).toHaveLength(1);
  });

  it("failed retry source removal retains a copy and retry converges", async () => {
    await quarantineSale(pending("A"), "invalid");
    jest
      .mocked(AsyncStorage.setItem)
      .mockImplementationOnce(async (key, value) => {
        mockStore.set(key, value);
      })
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(retryStuckSale("A")).rejects.toThrow("write failed");
    expect((await listPendingSales())[0].id).toBe("A");
    expect((await listStuckSales())[0].sale.id).toBe("A");
    await retryStuckSale("A");
    expect(await listPendingSales()).toHaveLength(1);
    expect(await listStuckSales()).toEqual([]);
  });
});

it.each(["quarantine", "retry"])(
  "failed %s destination write leaves the source unchanged",
  async (operation) => {
    const sale = pending("A");
    await enqueueSale(sale);
    if (operation === "retry") await quarantineSale(sale, "invalid");
    const before = await exportRawSalesStorage();
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("destination unavailable"));
    await expect(
      operation === "retry" ? retryStuckSale("A") : quarantineSale(sale, "invalid")
    ).rejects.toThrow("destination unavailable");
    expect(await exportRawSalesStorage()).toEqual(before);
  }
);
