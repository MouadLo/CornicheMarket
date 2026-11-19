import { deleteErrorKey, deleteInvoiceDraft } from "../../src/lib/stock/invoices";
import { confirmAndDeleteInvoiceDraft } from "../../src/lib/stock/deleteInvoiceDraftFlow";

const mockRpc = jest.fn();
const mockRemove = jest.fn();
const mockConfirm = jest.fn();
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: { from: (bucket: string) => ({ remove: (p: string[]) => mockRemove(bucket, p) }) },
  },
}));
jest.mock("../../src/lib/confirmDestructive", () => ({
  confirmDestructive: (...args: unknown[]) => mockConfirm(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("deleteInvoiceDraft", () => {
  it("deletes the draft, then removes the photos the RPC returned", async () => {
    mockRpc.mockResolvedValue({ data: ["d/1.jpg", "d/2.jpg"], error: null });
    mockRemove.mockResolvedValue({ error: null });
    await deleteInvoiceDraft("d");
    expect(mockRpc).toHaveBeenCalledWith("delete_invoice_draft", { p_id: "d" });
    expect(mockRemove).toHaveBeenCalledWith("invoices", ["d/1.jpg", "d/2.jpg"]);
    expect(mockRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mockRemove.mock.invocationCallOrder[0]
    );
  });

  it("does not touch Storage when there are no photos", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await deleteInvoiceDraft("d");
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("does not remove photos when the database refuses", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "approved", code: "CM413" } });
    await expect(deleteInvoiceDraft("d")).rejects.toMatchObject({ code: "CM413" });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("does not throw when the photos cannot be removed", async () => {
    mockRpc.mockResolvedValue({ data: ["d/1.jpg"], error: null });
    mockRemove.mockResolvedValueOnce({ error: { message: "nope" } });
    await expect(deleteInvoiceDraft("d")).resolves.toBeUndefined();
    mockRemove.mockRejectedValueOnce(new Error("offline"));
    await expect(deleteInvoiceDraft("d")).resolves.toBeUndefined();
  });

  it("maps the server's refusals to translation keys", () => {
    expect(deleteErrorKey("CM413")).toBe("invoices.deleteApproved");
    expect(deleteErrorKey("CM415")).toBe("invoices.deleteBusy");
    expect(deleteErrorKey("CM404")).toBe("invoices.deleteGone");
    expect(deleteErrorKey("42501")).toBe("invoices.deleteError");
    expect(deleteErrorKey(null)).toBe("invoices.deleteError");
  });
});

describe("confirmAndDeleteInvoiceDraft", () => {
  const t = (key: string, options?: Record<string, string>) =>
    key + (options ? " " + JSON.stringify(options) : "");
  const draft = { id: "d", invoice_number: "INV-1", suppliers: { name: "Acme" } };

  it("names the invoice and supplier, and deletes only after a yes", async () => {
    mockConfirm.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await confirmAndDeleteInvoiceDraft(draft, t)).toEqual({ result: "deleted" });
    const [, message] = mockConfirm.mock.calls[0];
    expect(message).toContain("invoices.deleteMessageSupplier");
    expect(message).toContain("INV-1");
    expect(message).toContain("Acme");
  });

  it("deletes nothing when cancelled", async () => {
    mockConfirm.mockResolvedValue(false);
    expect(await confirmAndDeleteInvoiceDraft(draft, t)).toEqual({ result: "cancelled" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("falls back to the untitled label and reports the error key", async () => {
    mockConfirm.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: null, error: { message: "busy", code: "CM415" } });
    const outcome = await confirmAndDeleteInvoiceDraft(
      { id: "d", invoice_number: null, suppliers: null },
      t
    );
    expect(outcome).toEqual({ result: "error", key: "invoices.deleteBusy" });
    expect(mockConfirm.mock.calls[0][1]).toContain("invoices.deleteMessage ");
    expect(mockConfirm.mock.calls[0][1]).toContain("invoices.untitled");
  });
});
