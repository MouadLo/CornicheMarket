import {
  createCategory,
  createSub,
  deleteCategory,
  deleteSub,
  fetchUsageCounts,
  InUseError,
  moveCategory,
  moveSub,
  updateCategory,
  updateSub,
} from "../../src/lib/webstore/categoryQueries";
import {
  createKit,
  deleteKit,
  fetchKits,
  saveKitItems,
  setKitPublished,
  updateKit,
} from "../../src/lib/webstore/kitQueries";

type Call = { table: string; op: string; payload?: unknown; filters: string[] };
const mockCalls: Call[] = [];
let mockResult: (call: Call) => {
  data?: unknown;
  error?: unknown;
  count?: number | null;
} = () => ({
  data: [],
  error: null,
});

// A fake query builder: it records the operation, its payload and every filter,
// and resolves (when awaited) to whatever mockResult says.
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [] };
      const builder: Record<string, unknown> = {};
      const chain =
        (name: string) =>
        (...args: unknown[]) => {
          if (name === "insert" || name === "update" || name === "delete") {
            call.op = name;
            call.payload = args[0];
          } else if (name === "eq") {
            call.filters.push(`${args[0]}=${args[1]}`);
          }
          return builder;
        };
      for (const name of [
        "select",
        "insert",
        "update",
        "delete",
        "eq",
        "order",
        "limit",
        "range",
      ]) {
        builder[name] = chain(name);
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        mockCalls.push(call);
        return Promise.resolve({ error: null, ...mockResult(call) }).then(resolve, reject);
      };
      return builder;
    },
  },
}));

beforeEach(() => {
  mockCalls.length = 0;
  mockResult = () => ({ data: [], error: null });
});

const writes = () => mockCalls.filter((c) => c.op === "update" || c.op === "delete");

describe("every UPDATE and DELETE has a filter", () => {
  it("kits", async () => {
    await updateKit("kit_a", { name: "x" });
    await setKitPublished("kit_a", false);
    await saveKitItems("kit_a", [{ web_product_id: "p001", qty: 1 }]);
    await deleteKit("kit_a");
    expect(writes().length).toBe(4);
    for (const w of writes()) expect(w.filters.length).toBeGreaterThan(0);
  });

  it("categories and sub-categories", async () => {
    await updateCategory("drinks", { icon: "gift" });
    await moveCategory(
      [
        { id: "a", sort: 0 },
        { id: "b", sort: 1 },
      ],
      "a",
      1
    );
    await deleteCategory("drinks");
    await updateSub("drinks", "soda", { name: "x" });
    await moveSub(
      "drinks",
      [
        { code: "soda", sort: 0 },
        { code: "water", sort: 1 },
      ],
      "soda",
      1
    );
    await deleteSub("drinks", "soda");
    expect(writes().length).toBe(8);
    for (const w of writes()) expect(w.filters.length).toBeGreaterThan(0);
  });

  it("a sub-category is always filtered on BOTH keys", async () => {
    await updateSub("drinks", "soda", { name: "x" });
    await moveSub(
      "drinks",
      [
        { code: "soda", sort: 0 },
        { code: "water", sort: 1 },
      ],
      "soda",
      1
    );
    await deleteSub("drinks", "soda");
    const subWrites = writes().filter((w) => w.table === "web_subcategories");
    expect(subWrites.length).toBe(4);
    for (const w of subWrites) {
      expect(w.filters).toContain("category_id=drinks");
      expect(w.filters.some((f) => f.startsWith("code="))).toBe(true);
    }
    // the products count of a sub is by category AND sub code too
    const count = mockCalls.find((c) => c.table === "web_products");
    expect(count?.filters).toEqual(["category_id=drinks", "sub_code=soda"]);
  });
});

describe("kits", () => {
  it("fetchKits orders kits and lines like the feed (sort, then id)", async () => {
    mockResult = () => ({
      data: [
        {
          id: "b",
          name: "B",
          name_fr: null,
          published: true,
          sort: 1,
          items: [
            { web_product_id: "p2", qty: 1, sort: 10 },
            { web_product_id: "p1", qty: 1, sort: 10 },
            { web_product_id: "p0", qty: 1, sort: 0 },
          ],
        },
        { id: "a", name: "A", name_fr: null, published: true, sort: 1, items: [] },
        { id: "c", name: "C", name_fr: null, published: true, sort: 0, items: null },
      ],
    });
    const kits = await fetchKits();
    expect(kits.map((k) => k.id)).toEqual(["c", "a", "b"]);
    expect(kits[2].items.map((i) => i.web_product_id)).toEqual(["p0", "p1", "p2"]);
    expect(kits[0].items).toEqual([]);
  });

  it("createKit puts the new kit last", async () => {
    mockResult = (c) => (c.op === "select" ? { data: [{ sort: 7 }] } : {});
    await createKit({ id: "kit_x", name: "X", name_fr: null, published: true });
    const insert = mockCalls.find((c) => c.op === "insert");
    expect(insert?.payload).toEqual({
      id: "kit_x",
      name: "X",
      name_fr: null,
      published: true,
      sort: 8,
    });
  });

  it("saveKitItems deletes the kit's lines, then inserts with sort = index * 10", async () => {
    await saveKitItems("kit_a", [
      { web_product_id: "p3", qty: 2 },
      { web_product_id: "p1", qty: 5 },
    ]);
    expect(mockCalls.map((c) => c.op)).toEqual(["delete", "insert"]);
    expect(mockCalls[0].filters).toEqual(["kit_id=kit_a"]);
    expect(mockCalls[1].payload).toEqual([
      { kit_id: "kit_a", web_product_id: "p3", qty: 2, sort: 0 },
      { kit_id: "kit_a", web_product_id: "p1", qty: 5, sort: 10 },
    ]);
  });

  it("saveKitItems with no lines only deletes", async () => {
    await saveKitItems("kit_a", []);
    expect(mockCalls.map((c) => c.op)).toEqual(["delete"]);
  });

  it("puts the previous lines back when the insert fails, then throws", async () => {
    mockResult = (c) =>
      c.op === "insert" && mockCalls.length === 2 ? { error: { message: "boom" } } : {};
    await expect(
      saveKitItems("kit_a", [{ web_product_id: "p9", qty: 1 }], [{ web_product_id: "p1", qty: 3 }])
    ).rejects.toThrow("boom");
    expect(mockCalls.map((c) => c.op)).toEqual(["delete", "insert", "insert"]);
    expect(mockCalls[2].payload).toEqual([
      { kit_id: "kit_a", web_product_id: "p1", qty: 3, sort: 0 },
    ]);
  });
});

describe("categories", () => {
  it("createCategory and createSub go last in their own list", async () => {
    mockResult = (c) => (c.op === "select" ? { data: [{ sort: 3 }] } : {});
    await createCategory({ id: "gifts", name: "Gifts", name_fr: "Cadeaux", icon: "gift" });
    await createSub("gifts", { code: "Toys", name: "Toys", name_fr: "Jouets" });
    const inserts = mockCalls.filter((c) => c.op === "insert");
    expect(inserts[0].payload).toMatchObject({ id: "gifts", sort: 4 });
    expect(inserts[1].payload).toMatchObject({ category_id: "gifts", code: "Toys", sort: 4 });
    // the last sub is read inside its own category
    const subSelect = mockCalls.find((c) => c.table === "web_subcategories" && c.op === "select");
    expect(subSelect?.filters).toEqual(["category_id=gifts"]);
  });

  it("moveCategory swaps the two sort values, one update each by id", async () => {
    await moveCategory(
      [
        { id: "a", sort: 0 },
        { id: "b", sort: 5 },
      ],
      "b",
      -1
    );
    expect(writes().map((w) => [w.filters[0], (w.payload as { sort: number }).sort])).toEqual([
      ["id=b", 0],
      ["id=a", 5],
    ]);
  });

  it("moveCategory renumbers when the two have the same sort", async () => {
    await moveCategory(
      [
        { id: "a", sort: 0 },
        { id: "b", sort: 0 },
        { id: "c", sort: 0 },
      ],
      "c",
      -1
    );
    expect(writes().map((w) => [w.filters[0], (w.payload as { sort: number }).sort])).toEqual([
      ["id=c", 10],
      ["id=b", 20],
    ]);
  });

  it("deleteCategory refuses while products use it, with the count, and deletes nothing", async () => {
    mockResult = (c) => (c.table === "web_products" ? { count: 4 } : {});
    await expect(deleteCategory("drinks")).rejects.toMatchObject({ count: 4 });
    await expect(deleteCategory("drinks")).rejects.toBeInstanceOf(InUseError);
    expect(writes()).toEqual([]);
  });

  it("deleteSub refuses while products use it", async () => {
    mockResult = (c) => (c.table === "web_products" ? { count: 2 } : {});
    await expect(deleteSub("drinks", "soda")).rejects.toMatchObject({ count: 2 });
    expect(writes()).toEqual([]);
  });

  it("maps a foreign key error (23503) to the same refusal", async () => {
    mockResult = (c) =>
      c.op === "delete"
        ? { error: { message: "violates foreign key", code: "23503" } }
        : { count: 0 };
    await expect(deleteCategory("drinks")).rejects.toBeInstanceOf(InUseError);
    await expect(deleteSub("drinks", "soda")).rejects.toBeInstanceOf(InUseError);
  });

  it("other errors stay plain errors", async () => {
    mockResult = (c) =>
      c.op === "delete" ? { error: { message: "nope", code: "42501" } } : { count: 0 };
    const failure = await deleteCategory("drinks").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InUseError);
  });

  it("fetchUsageCounts counts per category and per sub", async () => {
    mockResult = () => ({
      data: [
        { category_id: "drinks", sub_code: "soda" },
        { category_id: "drinks", sub_code: null },
      ],
    });
    expect(await fetchUsageCounts()).toEqual({
      byCategory: { drinks: 2 },
      bySub: { "drinks/soda": 1 },
    });
  });
});
