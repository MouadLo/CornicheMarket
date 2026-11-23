import {
  addShop,
  confirmMatch,
  deleteShop,
  fetchCatalogCategories,
  fetchCatalogCounts,
  fetchCatalogPage,
  fetchCompetitorImage,
  fetchShops,
  readShopNow,
  rematch,
  setItemDecision,
  updateSourcing,
} from "../../src/lib/competitors/shops";
import { DEFAULT_FILTERS } from "../../src/lib/competitors/catalog";

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockDeleteEq = jest.fn();
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    from: (table: string) => ({
      delete: () => ({ eq: (...a: unknown[]) => mockDeleteEq(table, ...a) }),
    }),
  },
}));

const httpError = (status: number, body: object) => ({
  message: "Edge Function returned a non-2xx status code",
  context: { status, json: async () => body },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockDeleteEq.mockResolvedValue({ error: null });
});

describe("lists", () => {
  it("fetches the shops and the counts", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: "s" }], error: null });
    expect(await fetchShops()).toEqual([{ id: "s" }]);
    expect(mockRpc).toHaveBeenCalledWith("competitor_shop_overview");
    mockRpc.mockResolvedValueOnce({
      data: [{ proposed: "3", missing: 4, wanted: null }],
      error: null,
    });
    expect(await fetchCatalogCounts()).toEqual({ proposed: 3, missing: 4, wanted: 0 });
  });
  it("passes the filters and the sort of the view to the database", async () => {
    await fetchCatalogPage(
      "missing",
      { shopId: "s", category: "Chips", inStockOnly: true, promoOnly: true, sort: "price_desc" },
      60
    );
    expect(mockRpc).toHaveBeenCalledWith("competitor_catalog_page", {
      p_view: "missing",
      p_shop: "s",
      p_category: "Chips",
      p_in_stock_only: true,
      p_promo_only: true,
      p_sort: "price_desc",
      p_limit: 30,
      p_offset: 60,
    });
  });
  it("proposed pairs sort by score, wanted items by decision date", async () => {
    await fetchCatalogPage("proposed", DEFAULT_FILTERS, 0);
    expect(mockRpc.mock.calls[0][1].p_sort).toBe("score");
    await fetchCatalogPage("wanted", DEFAULT_FILTERS, 0);
    expect(mockRpc.mock.calls[1][1].p_sort).toBe("decided");
  });
  it("converts the total count to a number", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: "a", total_count: "1511" }], error: null });
    expect((await fetchCatalogPage("missing", DEFAULT_FILTERS, 0))[0].total_count).toBe(1511);
  });
  it("lists categories", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ category: "Chips", items: 3 }], error: null });
    expect(await fetchCatalogCategories("missing", null)).toEqual(["Chips"]);
  });
  it("throws the database error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "only the owner can read competitor shops" },
    });
    await expect(fetchShops()).rejects.toThrow("only the owner");
  });
});

describe("decisions", () => {
  it("call the SQL functions", async () => {
    mockRpc.mockResolvedValueOnce({ data: "link-1", error: null });
    expect(await confirmMatch("i", "p")).toBe("link-1");
    expect(mockRpc).toHaveBeenCalledWith("confirm_competitor_match", {
      p_item_id: "i",
      p_product_id: "p",
    });
    await setItemDecision("i", "wanted");
    expect(mockRpc).toHaveBeenCalledWith("set_competitor_item_decision", {
      p_item_id: "i",
      p_decision: "wanted",
    });
    await updateSourcing("i", { note: "n", supplierId: null, status: "asked" });
    expect(mockRpc).toHaveBeenCalledWith("update_competitor_sourcing", {
      p_item_id: "i",
      p_note: "n",
      p_supplier_id: null,
      p_status: "asked",
    });
  });
  it("surface errors", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "product already matched in this shop" },
    });
    await expect(confirmMatch("i", "p")).rejects.toThrow("already matched");
  });
  it("deleting a shop deletes only the shop row", async () => {
    await deleteShop("s1");
    expect(mockDeleteEq).toHaveBeenCalledWith("competitor_shops", "id", "s1");
  });
});

describe("the edge function", () => {
  it("adds a shop", async () => {
    mockInvoke.mockResolvedValue({ data: { status: "added", shopId: "s" }, error: null });
    expect(await addShop("yournightshop.ma", " Night ")).toEqual({ status: "added", shopId: "s" });
    expect(mockInvoke).toHaveBeenCalledWith("sync-competitor-shop", {
      body: { action: "add", url: "yournightshop.ma", name: "Night" },
    });
  });
  it("a read that runs out of time is continued until it finishes", async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { status: "syncing", nextPage: 7 }, error: null })
      .mockResolvedValueOnce({ data: { status: "syncing", nextPage: 13 }, error: null })
      .mockResolvedValueOnce({ data: { status: "ok", items: 1511 }, error: null });
    const progress: number[] = [];
    expect(await readShopNow("s", (page) => progress.push(page))).toEqual({
      status: "ok",
      items: 1511,
    });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([7, 13]);
  });
  it("stops continuing after a bounded number of calls", async () => {
    mockInvoke.mockResolvedValue({ data: { status: "syncing", nextPage: 2 }, error: null });
    expect((await readShopNow("s", undefined, 3)).status).toBe("syncing");
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });
  it("too soon, busy, refused and network are results", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(429, { error: "too_soon", retry_after_seconds: 1200 }),
    });
    expect(await readShopNow("s")).toEqual({ status: "rate_limited", retryAfterSeconds: 1200 });
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(409, { error: "busy" }) });
    expect(await readShopNow("s")).toEqual({ status: "busy" });
    mockInvoke.mockResolvedValueOnce({
      data: { status: "refused", detail: "http_403" },
      error: null,
    });
    expect(await readShopNow("s")).toEqual({ status: "refused", detail: "http_403" });
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: "failed" } });
    expect(await readShopNow("s")).toEqual({ status: "error", detail: "network" });
  });
  it("a non-owner session is an error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(403, { error: "owner_only" }),
    });
    await expect(readShopNow("s")).rejects.toThrow("owner only");
  });
  it("recalculates without a shop id for every shop", async () => {
    mockInvoke.mockResolvedValue({ data: { status: "ok", proposed: 12 }, error: null });
    expect(await rematch()).toBe(12);
    expect(mockInvoke).toHaveBeenCalledWith("sync-competitor-shop", {
      body: { action: "rematch" },
    });
    await rematch("s1");
    expect(mockInvoke).toHaveBeenLastCalledWith("sync-competitor-shop", {
      body: { action: "rematch", shopId: "s1" },
    });
  });
  it("asks competitor-image for a stored url", async () => {
    mockInvoke.mockResolvedValue({
      data: { status: "ok", contentType: "image/png", extension: "png", base64: "AA==" },
      error: null,
    });
    expect((await fetchCompetitorImage("https://x.ma/a.png")).status).toBe("ok");
    expect(mockInvoke).toHaveBeenCalledWith("competitor-image", {
      body: { url: "https://x.ma/a.png" },
    });
  });
});
