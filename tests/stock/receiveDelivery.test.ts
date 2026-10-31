/**
 * C03/C07: receiving used to be three separate writes (purchase header,
 * purchase lines, selling prices), so a failure after the first one left a
 * half-saved delivery, and a retry received the stock again. These pin the
 * replacement: exactly one RPC carrying everything, keyed by the caller's
 * operation id, and a typed error when the server says that id was already
 * used for a different delivery.
 */
import { ReceiveDeliveryError, receiveDelivery } from "../../src/lib/stock/queries";

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, payload: unknown) => mockRpc(fn, payload),
    from: (table: string) => mockFrom(table),
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

const draft = {
  supplierId: "sup-1",
  notes: "BL 1234",
  lines: [{ product_id: "p1", quantity: 10, unit_cost_cents: 600, expiry_date: "2026-03-31" }],
  priceUpdates: [{ product_id: "p1", selling_price_cents: 1200 }],
};

describe("receiveDelivery", () => {
  it("sends header, lines and price changes in one receive_delivery call", async () => {
    mockRpc.mockResolvedValue({ data: "purchase-1", error: null });

    const id = await receiveDelivery("op-1", draft);

    expect(id).toBe("purchase-1");
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("receive_delivery", {
      p_operation_id: "op-1",
      p_supplier_id: "sup-1",
      p_notes: "BL 1234",
      p_lines: draft.lines,
      p_price_updates: draft.priceUpdates,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reports an operation id reused for different details as already saved", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "CM409", message: "This delivery was already saved with different details" },
    });

    const failure = await receiveDelivery("op-1", draft).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ReceiveDeliveryError);
    expect((failure as ReceiveDeliveryError).kind).toBe("already_saved");
  });

  it("passes any other server refusal through with its message", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "Line 1: expiry date 2026-02-31 is not a real date" },
    });

    const failure = await receiveDelivery("op-1", draft).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ReceiveDeliveryError);
    expect((failure as ReceiveDeliveryError).kind).toBe("rejected");
    expect((failure as Error).message).toContain("2026-02-31");
  });
});
