import {
  buildArrangementPayload,
  contentHeight,
  dropIndex,
  dropIndexForDrag,
  hasArrangementChanges,
  moveItem,
  moveTab,
  moveTile,
  resolveArrangeTabs,
  slotOrigin,
  toggleTabVisible,
  toggleTileHidden,
  type GridGeometry,
} from "../../src/lib/sellGrid/arrange";
import { resolveGrid } from "../../src/lib/sellGrid/layout";
import type { GridProduct, GridTab, GridTile } from "../../src/lib/sellGrid/layout";

const product = (id: string, name: string, category: string | null): GridProduct => ({
  id,
  name,
  barcode: null,
  category_id: category,
  unit: "piece",
  selling_price_cents: 100,
  stock_quantity: 10,
  low_stock_threshold: 2,
  active: true,
});
const tab = (
  id: string,
  kind: GridTab["kind"],
  category: string | null,
  position: number,
  extra: Partial<GridTab> = {}
): GridTab => ({
  id,
  kind,
  category_id: category,
  label: null,
  position,
  visible: true,
  auto_fill: kind === "category",
  ...extra,
});
const tile = (
  tab_id: string,
  product_id: string,
  position: number,
  extra: Partial<GridTile> = {}
): GridTile => ({
  id: `${tab_id}-${product_id}`,
  tab_id,
  product_id,
  position,
  hidden: false,
  pinned: false,
  color: null,
  short_label: null,
  ...extra,
});

const products = [
  product("a", "Apple", "fruit"),
  product("b", "Banana", "fruit"),
  product("c", "Cherry", "fruit"),
  product("m", "Milk", "dairy"),
];
const categories = [
  { id: "fruit", name: "Fruit" },
  { id: "dairy", name: "Dairy" },
];
const base = {
  products,
  categories,
  favoritesLabel: "Favoris",
};
const keys = (t: { tiles: { key: string }[] }) => t.tiles.map((x) => x.key);

describe("moveItem", () => {
  it("moves forward, backward, clamps and ignores a bad index", () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
    expect(moveItem([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 1, -4)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 7, 0)).toEqual([1, 2, 3]);
  });
});

describe("geometry", () => {
  const ltr: GridGeometry = { columns: 3, tileWidth: 100, tileHeight: 50, gap: 10, rtl: false };
  const rtl: GridGeometry = { ...ltr, rtl: true };

  it("lays slots out left to right, or right to left in Arabic", () => {
    expect(slotOrigin(0, ltr)).toEqual({ x: 0, y: 0 });
    expect(slotOrigin(2, ltr)).toEqual({ x: 220, y: 0 });
    expect(slotOrigin(4, ltr)).toEqual({ x: 110, y: 60 });
    expect(slotOrigin(0, rtl)).toEqual({ x: 220, y: 0 });
    expect(slotOrigin(2, rtl)).toEqual({ x: 0, y: 0 });
    expect(slotOrigin(4, rtl)).toEqual({ x: 110, y: 60 });
  });

  it("finds the slot under a point and clamps to the grid", () => {
    expect(dropIndex({ x: 5, y: 5 }, 7, ltr)).toBe(0);
    expect(dropIndex({ x: 230, y: 5 }, 7, ltr)).toBe(2);
    expect(dropIndex({ x: 120, y: 70 }, 7, ltr)).toBe(4);
    expect(dropIndex({ x: 999, y: 999 }, 7, ltr)).toBe(6); // last tile
    expect(dropIndex({ x: -50, y: -50 }, 7, ltr)).toBe(0);
    expect(dropIndex({ x: 0, y: 0 }, 0, ltr)).toBe(0);
  });

  it("in RTL the right-most column is the first tile", () => {
    expect(dropIndex({ x: 250, y: 5 }, 7, rtl)).toBe(0);
    expect(dropIndex({ x: 5, y: 5 }, 7, rtl)).toBe(2);
    expect(dropIndex({ x: 120, y: 70 }, 7, rtl)).toBe(4);
  });

  it("drag deltas are physical: dragging a tile to the right moves it earlier in RTL", () => {
    // Tile 1 (middle column) dragged one column right.
    expect(dropIndexForDrag(1, { dx: 110, dy: 0 }, 6, ltr)).toBe(2);
    expect(dropIndexForDrag(1, { dx: 110, dy: 0 }, 6, rtl)).toBe(0);
    // One row down.
    expect(dropIndexForDrag(1, { dx: 0, dy: 60 }, 6, ltr)).toBe(4);
    // No movement stays put.
    expect(dropIndexForDrag(4, { dx: 0, dy: 0 }, 6, rtl)).toBe(4);
  });

  it("measures the content height", () => {
    expect(contentHeight(0, ltr)).toBe(0);
    expect(contentHeight(3, ltr)).toBe(50);
    expect(contentHeight(4, ltr)).toBe(110);
  });
});

describe("resolveArrangeTabs", () => {
  const tabs = [
    tab("fav", "favorites", null, 0),
    tab("t-fruit", "category", "fruit", 1),
    tab("t-dairy", "category", "dairy", 2, { visible: false }),
  ];
  const tiles = [
    tile("fav", "c", 0),
    tile("fav", "a", 1),
    tile("fav", "b", 2, { hidden: true }),
    tile("t-fruit", "c", 0),
    tile("t-fruit", "b", 1, { hidden: true }),
  ];
  const result = resolveArrangeTabs({ ...base, tabs, tiles });

  it("keeps hidden tabs, with their flag", () => {
    expect(result.map((t) => [t.id, t.visible])).toEqual([
      ["fav", true],
      ["t-fruit", true],
      ["t-dairy", false],
    ]);
  });

  it("puts the hidden tiles last, on Favoris and on a category tab", () => {
    expect(result[0].tiles.map((x) => [x.key, x.hidden])).toEqual([
      ["c", false],
      ["a", false],
      ["b", true],
    ]);
    expect(result[1].tiles.map((x) => [x.key, x.hidden])).toEqual([
      ["c", false],
      ["a", false],
      ["b", true],
    ]);
  });

  it("shows exactly what Sell shows, before the hidden ones", () => {
    const sell = resolveGrid({ ...base, tabs, tiles });
    expect(sell.map((t) => keys(t))).toEqual([
      ["c", "a"],
      ["c", "a"],
    ]);
  });
});

describe("pending changes", () => {
  const tabs = [
    tab("fav", "favorites", null, 0),
    tab("t-fruit", "category", "fruit", 1),
    tab("t-dairy", "category", "dairy", 2),
  ];
  const tiles = [tile("fav", "a", 0), tile("fav", "b", 1), tile("fav", "c", 2, { color: "red" })];
  const original = resolveArrangeTabs({ ...base, tabs, tiles });

  it("moves a tile and keeps hidden tiles last", () => {
    const moved = moveTile(original, "fav", 0, 2);
    expect(keys(moved[0])).toEqual(["b", "c", "a"]);
    const hidden = toggleTileHidden(moved, "fav", "b");
    expect(hidden[0].tiles.map((x) => [x.key, x.hidden])).toEqual([
      ["c", false],
      ["a", false],
      ["b", true],
    ]);
    // A shown tile dragged to the end stays before the hidden group.
    expect(keys(moveTile(hidden, "fav", 0, 2)[0])).toEqual(["a", "c", "b"]);
    // Showing it again puts it after the shown tiles.
    const shown = toggleTileHidden(hidden, "fav", "b");
    expect(shown[0].tiles.map((x) => [x.key, x.hidden])).toEqual([
      ["c", false],
      ["a", false],
      ["b", false],
    ]);
  });

  it("moves tabs and refuses to hide the last visible one", () => {
    expect(moveTab(original, 0, 2).map((t) => t.id)).toEqual(["t-fruit", "t-dairy", "fav"]);
    let next = toggleTabVisible(original, "fav");
    expect(next.find((t) => t.id === "fav")?.visible).toBe(false);
    next = toggleTabVisible(next, "t-fruit");
    const last = toggleTabVisible(next, "t-dairy");
    expect(last).toBe(next); // refused: unchanged
    expect(last.filter((t) => t.visible).map((t) => t.id)).toEqual(["t-dairy"]);
    // A hidden tab can come back.
    expect(toggleTabVisible(next, "fav").find((t) => t.id === "fav")?.visible).toBe(true);
  });

  it("is a no-op when nothing changed", () => {
    expect(hasArrangementChanges(original, original)).toBe(false);
    expect(buildArrangementPayload(original, original)).toBeNull();
    // Moving a tile and moving it back is no change either.
    const there = moveTile(original, "fav", 0, 1);
    expect(hasArrangementChanges(original, moveTile(there, "fav", 1, 0))).toBe(false);
  });
});

describe("buildArrangementPayload", () => {
  const tabs = [
    tab("fav", "favorites", null, 0),
    tab("t-fruit", "category", "fruit", 1),
    tab("t-dairy", "category", "dairy", 2),
  ];
  const tiles = [tile("fav", "a", 0), tile("fav", "b", 1)];
  const original = resolveArrangeTabs({ ...base, tabs, tiles });

  it("Favoris: the full ordered list of its rows", () => {
    const working = moveTile(original, "fav", 0, 1);
    expect(buildArrangementPayload(original, working)).toEqual({
      tabs: [
        { id: "fav", position: 0, visible: true },
        { id: "t-fruit", position: 1, visible: true },
        { id: "t-dairy", position: 2, visible: true },
      ],
      tiles: [
        { tab_id: "fav", product_id: "b", position: 0, hidden: false },
        { tab_id: "fav", product_id: "a", position: 1, hidden: false },
      ],
    });
  });

  it("a category tab: every product of the tab gets an explicit position", () => {
    // Auto order is Apple, Banana, Cherry; the owner puts Cherry first.
    expect(keys(original[1])).toEqual(["a", "b", "c"]);
    const working = moveTile(original, "t-fruit", 2, 0);
    const payload = buildArrangementPayload(original, working);
    expect(payload?.tiles).toEqual([
      { tab_id: "t-fruit", product_id: "c", position: 0, hidden: false },
      { tab_id: "t-fruit", product_id: "a", position: 1, hidden: false },
      { tab_id: "t-fruit", product_id: "b", position: 2, hidden: false },
    ]);
  });

  it("only tabs whose tiles changed get tile rows; hidden tiles are sent hidden", () => {
    const working = toggleTileHidden(original, "t-fruit", "a");
    const payload = buildArrangementPayload(original, working);
    expect(payload?.tiles.map((x) => [x.tab_id, x.product_id, x.position, x.hidden])).toEqual([
      ["t-fruit", "b", 0, false],
      ["t-fruit", "c", 1, false],
      ["t-fruit", "a", 2, true],
    ]);
  });

  it("a tab-only change sends tabs and no tiles", () => {
    const working = toggleTabVisible(moveTab(original, 2, 0), "t-fruit");
    const payload = buildArrangementPayload(original, working);
    expect(payload?.tiles).toEqual([]);
    expect(payload?.tabs).toEqual([
      { id: "t-dairy", position: 0, visible: true },
      { id: "fav", position: 1, visible: true },
      { id: "t-fruit", position: 2, visible: false },
    ]);
  });

  it("a saved arrangement resolves back to the same order, new products last", () => {
    const working = moveTile(original, "t-fruit", 2, 0); // c, a, b
    const payload = buildArrangementPayload(original, working)!;
    const saved = payload.tiles.map((x, i) =>
      tile(x.tab_id, x.product_id, x.position, { id: `r${i}` })
    );
    const withNew = [...products, product("d", "Apricot", "fruit")];
    const again = resolveGrid({
      ...base,
      products: withNew,
      tabs,
      tiles: [...tiles, ...saved],
    });
    // The new product has no row: it follows the placed ones.
    expect(keys(again.find((t) => t.id === "t-fruit")!)).toEqual(["c", "a", "b", "d"]);
  });
});
