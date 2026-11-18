/**
 * Saving one product's tile settings touches only that product's rows, never
 * another tile's position, pinned/hidden flags or label.
 */
import { fetchProductTileSettings, saveProductTileSettings } from "../../src/lib/sellGrid/queries";
import { TileSettingsError } from "../../src/lib/sellGrid/tileSettings";

const mockCalls: { table: string; op: string; args: unknown[]; filters: unknown[][] }[] = [];
let mockTabs: Record<string, string> = { favorites: "FAV", category: "CAT" };
let mockFailOn: string | null = null;
let mockExistingTiles: { id: string; tab_id: string; color: string | null }[] = [];

function mockBuilder(table: string) {
  const call = { table, op: "select", args: [] as unknown[], filters: [] as unknown[][] };
  mockCalls.push(call);
  const b: Record<string, unknown> = {};
  const chain =
    (name: string) =>
    (...args: unknown[]) => {
      if (["insert", "update", "upsert", "delete", "select"].includes(name) && call.op === "select")
        call.op = name === "select" ? "select" : name;
      if (["insert", "update", "upsert"].includes(name)) call.args = args;
      if (["eq", "is"].includes(name)) call.filters.push([name, ...args]);
      return b;
    };
  for (const n of ["select", "insert", "update", "upsert", "delete", "eq", "is", "order", "limit"])
    b[n] = chain(n);
  const result = () => {
    if (mockFailOn === call.op) return { data: null, error: { message: "Failed to fetch" } };
    if (table === "sell_grid_tabs") {
      const kind = call.filters.find((f) => f[1] === "kind")?.[2] as string;
      return { data: { id: mockTabs[kind] }, error: null };
    }
    if (call.op === "select" && call.filters.some((f) => f[1] === "product_id"))
      return { data: mockExistingTiles, error: null };
    if (call.op === "select") return { data: [{ position: 4 }], error: null };
    return { data: null, error: null };
  };
  b.maybeSingle = async () => result();
  b.then = (resolve: (v: unknown) => unknown) => resolve(result());
  return b;
}
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { from: (table: string) => mockBuilder(table) },
}));

const writes = () => mockCalls.filter((c) => c.table === "sell_grid_tiles" && c.op !== "select");

beforeEach(() => {
  mockCalls.length = 0;
  mockFailOn = null;
  mockExistingTiles = [];
  mockTabs = { favorites: "FAV", category: "CAT" };
});

describe("saveProductTileSettings", () => {
  it("adds a favourite at the end and a colour-only row on the category tab", async () => {
    await saveProductTileSettings("p1", "c1", { favorite: true, color: "red" });
    const inserts = writes().filter((c) => c.op === "upsert");
    expect(inserts.map((c) => c.args[0])).toEqual([
      { tab_id: "FAV", product_id: "p1", position: 5, color: "red" },
      { tab_id: "CAT", product_id: "p1", position: -1, color: "red" },
    ]);
    // Existing rows are never overwritten by the insert.
    expect(
      inserts.every((c) => (c.args[1] as { ignoreDuplicates: boolean }).ignoreDuplicates)
    ).toBe(true);
  });

  it("every write is limited to this product", async () => {
    await saveProductTileSettings("p1", "c1", { favorite: false, color: null });
    for (const c of writes().filter((w) => w.op !== "upsert")) {
      expect(c.filters).toContainEqual(["eq", "product_id", "p1"]);
    }
  });

  it("removing from Favorites deletes only the favourites row", async () => {
    await saveProductTileSettings("p1", "c1", { favorite: false, color: "blue" });
    const deletes = writes().filter((c) => c.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toEqual([
      ["eq", "tab_id", "FAV"],
      ["eq", "product_id", "p1"],
    ]);
  });

  it("back to the default removes only a colour-only category row", async () => {
    await saveProductTileSettings("p1", "c1", { favorite: true, color: null });
    const cleanup = writes().filter((c) => c.filters.some((f) => f[2] === "CAT"));
    expect(cleanup.map((c) => c.op)).toEqual(["update", "delete"]);
    expect(cleanup[0].args[0]).toEqual({ color: null });
    expect(cleanup[1].filters).toEqual(
      expect.arrayContaining([
        ["eq", "position", -1],
        ["eq", "pinned", false],
        ["eq", "hidden", false],
        ["is", "short_label", null],
      ])
    );
  });

  it("wraps a failure so the form can say the product itself is saved", async () => {
    mockFailOn = "upsert";
    await expect(
      saveProductTileSettings("p1", "c1", { favorite: true, color: null })
    ).rejects.toBeInstanceOf(TileSettingsError);
  });
});

describe("fetchProductTileSettings", () => {
  it("reads favourite state and prefers the category tile's colour", async () => {
    mockExistingTiles = [
      { id: "1", tab_id: "FAV", color: "teal" },
      { id: "2", tab_id: "CAT", color: "amber" },
    ];
    expect(await fetchProductTileSettings("p1", "c1")).toEqual({ favorite: true, color: "amber" });
  });
  it("is the default for a product with no tiles", async () => {
    expect(await fetchProductTileSettings("p1", "c1")).toEqual({ favorite: false, color: null });
  });
});
