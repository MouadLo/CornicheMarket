/** The history's line query never reads a cost column (a cashier must not see it). */
import { fetchSaleLines } from "../../src/lib/sales/queries";

const mockFrom = jest.fn();
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a) },
}));

describe("fetchSaleLines", () => {
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    q.select = jest.fn(() => q);
    q.in = jest.fn(() => q);
    q.order = jest.fn(async () => ({ data: rows, error: null }));
    q.then = (r: (v: unknown) => void) => r({ data: rows, error: null });
    return q as { select: jest.Mock };
  };

  it("reads the cashier view and never selects a cost column", async () => {
    const items = chain([]);
    mockFrom.mockReset();
    mockFrom.mockReturnValue(items);
    await fetchSaleLines(["a"], false);
    expect(mockFrom).toHaveBeenCalledWith("sale_items_cashier_view");
    expect(items.select.mock.calls[0][0]).not.toMatch(/cost/);
  });

  it("owner reads sale_items, still without cost", async () => {
    const items = chain([]);
    mockFrom.mockReset();
    mockFrom.mockReturnValue(items);
    await fetchSaleLines(["a"], true);
    expect(mockFrom).toHaveBeenCalledWith("sale_items");
    expect(items.select.mock.calls[0][0]).not.toMatch(/cost/);
  });
});
