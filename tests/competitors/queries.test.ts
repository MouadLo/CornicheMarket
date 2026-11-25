import {
  applyCompetitorSuggestions,
  checkCompetitorLink,
  fetchCompetitorRows,
  saveManualPrice,
  setPriceCheck,
} from "../../src/lib/competitors/queries";

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockInserts: { table: string; row: unknown }[] = [];
const mockUpdates: { table: string; values: unknown }[] = [];
let mockLatestPoint: unknown = null;

jest.mock("../../src/lib/supabase/client", () => {
  const chain = (table: string) => {
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.eq = () => api;
    api.order = () => api;
    api.limit = () => api;
    api.maybeSingle = async () => ({ data: mockLatestPoint, error: null });
    api.insert = (row: unknown) => {
      mockInserts.push({ table, row });
      return Object.assign(Promise.resolve({ error: null }), api);
    };
    api.update = (values: unknown) => {
      mockUpdates.push({ table, values });
      return { eq: async () => ({ error: null }) };
    };
    return api;
  };
  return {
    supabase: {
      rpc: (...a: unknown[]) => mockRpc(...a),
      functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
      auth: { getSession: async () => ({ data: { session: { user: { id: "owner-1" } } } }) },
      from: (table: string) => chain(table),
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockInserts.length = 0;
  mockUpdates.length = 0;
  mockLatestPoint = null;
});

it("fetchCompetitorRows passes the product or null", async () => {
  mockRpc.mockResolvedValue({ data: [{ link_id: "l1" }], error: null });
  expect(await fetchCompetitorRows("p1")).toEqual([{ link_id: "l1" }]);
  expect(mockRpc).toHaveBeenCalledWith("competitor_price_overview", { p_product_id: "p1" });
  await fetchCompetitorRows();
  expect(mockRpc).toHaveBeenLastCalledWith("competitor_price_overview", { p_product_id: null });
});

it("applyCompetitorSuggestions sends one batch and returns the undo id", async () => {
  mockRpc.mockResolvedValue({ data: { batch_id: "b1", changed: 2 }, error: null });
  const result = await applyCompetitorSuggestions([
    { productId: "p1", priceCents: 1000 },
    { productId: "p2", priceCents: 950 },
  ]);
  expect(mockRpc).toHaveBeenCalledWith("apply_competitor_price_suggestions", {
    p_items: [
      { product_id: "p1", selling_price_cents: 1000 },
      { product_id: "p2", selling_price_cents: 950 },
    ],
  });
  expect(result).toEqual({ batchId: "b1", changed: 2 });
});

it("applyCompetitorSuggestions throws the server error", async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: "only the owner can change prices" } });
  await expect(applyCompetitorSuggestions([{ productId: "p1", priceCents: 1 }])).rejects.toThrow(
    "only the owner"
  );
});

it("setPriceCheck updates only the price_check column of products", async () => {
  await setPriceCheck("p1", true);
  expect(mockUpdates).toEqual([{ table: "products", values: { price_check: true } }]);
});

describe("checkCompetitorLink", () => {
  it("returns the function's answer", async () => {
    mockInvoke.mockResolvedValue({ data: { status: "refused", detail: "http_429" }, error: null });
    expect(await checkCompetitorLink("l1")).toEqual({ status: "refused", detail: "http_429" });
    expect(mockInvoke).toHaveBeenCalledWith("check-competitor-prices", {
      body: { linkId: "l1", retry: false },
    });
  });
  it("maps the 10-minute limit to a rate_limited result", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "non-2xx",
        context: {
          status: 429,
          json: async () => ({ error: "too_soon", retry_after_seconds: 420 }),
        },
      },
    });
    expect(await checkCompetitorLink("l1")).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 420,
    });
  });
  it("turns another failure into an error result, and a 403 into a thrown owner-only error", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "boom", context: { status: 500, json: async () => ({}) } },
    });
    expect(await checkCompetitorLink("l1")).toEqual({ status: "error", detail: "network" });
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "x",
        context: { status: 403, json: async () => ({ error: "owner_only" }) },
      },
    });
    await expect(checkCompetitorLink("l1")).rejects.toThrow("owner only");
  });
});

describe("saveManualPrice", () => {
  it("stores a point and stamps the link when the price is new, keeping title and photo", async () => {
    mockLatestPoint = {
      price_cents: 1000,
      regular_price_cents: 1000,
      in_stock: true,
      title: "T",
      image_url: "https://i/x.jpg",
    };
    await saveManualPrice("l1", { priceCents: 900, inStock: true });
    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0].row).toMatchObject({
      link_id: "l1",
      price_cents: 900,
      in_stock: true,
      source: "manual",
      entered_by: "owner-1",
      title: "T",
      image_url: "https://i/x.jpg",
    });
    expect(mockUpdates[0].values).toMatchObject({ last_status: "manual", mode: "manual" });
  });
  it("stores no point when nothing changed, but still stamps the link as checked", async () => {
    mockLatestPoint = {
      price_cents: 900,
      regular_price_cents: 900,
      in_stock: true,
      title: null,
      image_url: null,
    };
    await saveManualPrice("l1", { priceCents: 900, inStock: true });
    expect(mockInserts).toHaveLength(0);
    expect(mockUpdates).toHaveLength(1);
    expect(mockUpdates[0].values).toHaveProperty("last_ok_at");
  });
});
