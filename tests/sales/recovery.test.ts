/**
 * The owner's recovery of a sale stranded on a device (audit C05): the server
 * call must succeed before the sale leaves the queue, and a failure keeps it.
 */
import { recoverQueuedSale } from "../../src/lib/sales/recovery";

const mockRecoverSale = jest.fn();
const mockConfirmPending = jest.fn(async (_id: string) => {});

jest.mock("../../src/lib/sales/queries", () => ({
  recoverSale: (...a: unknown[]) => mockRecoverSale(...a),
}));
jest.mock("../../src/lib/sales/offlineQueue", () => ({
  confirmPendingSale: (id: string) => mockConfirmPending(id),
}));

const sale = { id: "s1", cashier_id: "user-a" } as never;

beforeEach(() => {
  mockRecoverSale.mockReset();
  mockConfirmPending.mockClear();
});

describe("recoverQueuedSale", () => {
  it("recorded now: removes it from the queue and says so", async () => {
    mockRecoverSale.mockResolvedValue(true);
    await expect(recoverQueuedSale(sale)).resolves.toBe("recovered");
    expect(mockConfirmPending).toHaveBeenCalledWith("s1");
  });

  it("already on the server: the local copy is dropped, nothing else changes", async () => {
    mockRecoverSale.mockResolvedValue(false);
    await expect(recoverQueuedSale(sale)).resolves.toBe("already-recorded");
    expect(mockConfirmPending).toHaveBeenCalledWith("s1");
  });

  it("a server failure keeps the sale in the queue and rethrows (same id can be recovered again)", async () => {
    mockRecoverSale.mockRejectedValue(new Error("Failed to fetch"));
    await expect(recoverQueuedSale(sale)).rejects.toThrow("Failed to fetch");
    expect(mockConfirmPending).not.toHaveBeenCalled();
  });
});
