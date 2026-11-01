import {
  resolveGrid,
  sellLayoutFor,
  stockLevel,
  tileColumns,
  type GridProduct,
  type GridTab,
  type GridTile,
} from "../../src/lib/sellGrid/layout";

const product = (
  id: string,
  name: string,
  category: string | null,
  extra: Partial<GridProduct> = {}
): GridProduct => ({
  id,
  name,
  barcode: null,
  category_id: category,
  unit: "piece",
  selling_price_cents: 100,
  stock_quantity: 10,
  low_stock_threshold: 2,
  active: true,
  ...extra,
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

const categories = [
  { id: "c-drinks", name: "Boissons" },
  { id: "c-bakery", name: "Boulangerie" },
];
const FAV = "Favoris";
const run = (tabs: GridTab[], tiles: GridTile[], products: GridProduct[]) =>
  resolveGrid({ tabs, tiles, products, categories, favoritesLabel: FAV });
const names = (t: { tiles: { product: GridProduct }[] }) => t.tiles.map((x) => x.product.name);

describe("category tabs auto-fill", () => {
  const products = [
    product("p1", "Sprite", "c-drinks"),
    product("p2", "Coca", "c-drinks"),
    product("p3", "Eau", "c-drinks"),
    product("p4", "Pain", "c-bakery"),
  ];

  it("a category's active products appear with no setup, alphabetically", () => {
    const tabs = [tab("t1", "category", "c-drinks", 1), tab("t2", "category", "c-bakery", 2)];
    const out = run(tabs, [], products);
    expect(out.map((t) => t.label)).toEqual(["Boissons", "Boulangerie"]);
    expect(names(out[0])).toEqual(["Coca", "Eau", "Sprite"]);
  });

  it("order is pinned, then placed by the owner, then the rest alphabetically; hidden are gone", () => {
    const tabs = [tab("t1", "category", "c-drinks", 1)];
    const tiles = [
      tile("t1", "p1", 1, { pinned: true }), // Sprite pinned
      tile("t1", "p3", 2), // Eau placed
      tile("t1", "p2", 3, { hidden: true }), // Coca hidden
    ];
    expect(names(run(tabs, tiles, products)[0])).toEqual(["Sprite", "Eau"]);
  });

  it("a new product in the category shows up after the placed ones (no row needed)", () => {
    const tabs = [tab("t1", "category", "c-drinks", 1)];
    const tiles = [tile("t1", "p3", 1)];
    const more = [...products, product("p9", "Ananas", "c-drinks")];
    expect(names(run(tabs, tiles, more)[0])).toEqual(["Eau", "Ananas", "Coca", "Sprite"]);
  });

  it("the order is deterministic: equal names tie-break by id", () => {
    const tabs = [tab("t1", "category", "c-drinks", 1)];
    const twins = [product("b", "Eau", "c-drinks"), product("a", "Eau", "c-drinks")];
    expect(run(tabs, [], twins)[0].tiles.map((x) => x.product.id)).toEqual(["a", "b"]);
  });
});

describe("Favoris is hand-picked only", () => {
  const products = [
    product("p1", "Coca", "c-drinks"),
    product("p2", "Pain", "c-bakery"),
    product("p3", "Eau", "c-drinks"),
  ];

  it("shows only the picks, in the owner's order, and never auto-fills", () => {
    const tabs = [tab("f", "favorites", null, 0)];
    const tiles = [tile("f", "p2", 1), tile("f", "p1", 2)];
    const out = run(tabs, tiles, products);
    expect(out[0].label).toBe(FAV);
    expect(names(out[0])).toEqual(["Pain", "Coca"]);
  });

  it("is hidden while empty", () => {
    expect(run([tab("f", "favorites", null, 0)], [], products)).toEqual([]);
  });

  it("a tile's colour and short label are used", () => {
    const tabs = [tab("f", "favorites", null, 0)];
    const out = run(tabs, [tile("f", "p1", 1, { color: "red", short_label: "Coca 33" })], products);
    expect(out[0].tiles[0]).toMatchObject({ label: "Coca 33", color: "red" });
  });

  it("an owner-set tab label wins over the default", () => {
    const out = run(
      [tab("f", "favorites", null, 0, { label: "Top ventes" })],
      [tile("f", "p1", 1)],
      products
    );
    expect(out[0].label).toBe("Top ventes");
  });
});

describe("edge cases (design 2.6)", () => {
  const tabs = [
    tab("f", "favorites", null, 0),
    tab("t1", "category", "c-drinks", 1),
    tab("t2", "category", "c-bakery", 2),
  ];

  it("a deactivated product's tile is hidden, but its row is kept (reactivating restores it)", () => {
    const tiles = [tile("f", "p1", 1)];
    const off = [product("p1", "Coca", "c-drinks", { active: false })];
    expect(run(tabs, tiles, off)).toEqual([]);
    const on = [product("p1", "Coca", "c-drinks", { active: true })];
    expect(names(run(tabs, tiles, on)[0])).toEqual(["Coca"]);
  });

  it("a pick whose product no longer exists is not shown", () => {
    expect(run(tabs, [tile("f", "ghost", 1)], [])).toEqual([]);
  });

  it("a product moved to another category leaves the old tab, joins the new one, and its old overrides stop applying", () => {
    const tiles = [tile("t1", "p1", 1, { pinned: true })]; // pinned on Boissons
    const moved = [product("p1", "Coca", "c-bakery"), product("p2", "Pain", "c-bakery")];
    const out = run(tabs, tiles, moved);
    expect(out.map((t) => t.label)).toEqual(["Boulangerie"]);
    expect(names(out[0])).toEqual(["Coca", "Pain"]); // alphabetical: the pin did not follow it
  });

  it("an empty category tab is not shown", () => {
    expect(
      run([tab("t1", "category", "c-drinks", 1)], [], [product("p", "Pain", "c-bakery")])
    ).toEqual([]);
  });

  it("a tab the owner hid is not shown", () => {
    const hidden = [tab("t1", "category", "c-drinks", 1, { visible: false })];
    expect(run(hidden, [], [product("p", "Coca", "c-drinks")])).toEqual([]);
  });

  it("no tabs at all gives nothing (Sell then looks as before)", () => {
    expect(run([], [], [product("p", "Coca", "c-drinks")])).toEqual([]);
  });

  it("tabs follow their position, with ties broken by id", () => {
    const t = [
      tab("b", "category", "c-bakery", 1),
      tab("a", "category", "c-drinks", 1),
      tab("z", "favorites", null, 0),
    ];
    const out = run(
      t,
      [tile("z", "p1", 1)],
      [product("p1", "Coca", "c-drinks"), product("p2", "Pain", "c-bakery")]
    );
    expect(out.map((x) => x.id)).toEqual(["z", "a", "b"]);
  });

  it("out-of-stock and negative-stock products still get a tile (selling is never blocked)", () => {
    const out = run(
      [tab("t1", "category", "c-drinks", 1)],
      [],
      [
        product("p1", "Coca", "c-drinks", { stock_quantity: 0 }),
        product("p2", "Eau", "c-drinks", { stock_quantity: -3 }),
      ]
    );
    expect(names(out[0])).toEqual(["Coca", "Eau"]);
  });
});

describe("stock badge", () => {
  it.each([
    [10, 2, "ok"],
    [3, 2, "ok"],
    [2, 2, "low"],
    [1, 2, "low"],
    [0, 2, "out"],
    [-2, 2, "out"],
    [5, 0, "ok"], // threshold 0: only "out" ever shows
    [0, 0, "out"],
  ])("stock %p, threshold %p -> %s", (stock, threshold, level) => {
    expect(stockLevel(stock, threshold)).toBe(level);
  });
});

describe("layout breakpoints", () => {
  it("grid and cart side by side from 900 dp, stacked below", () => {
    expect(sellLayoutFor(1366)).toBe("split");
    expect(sellLayoutFor(1280)).toBe("split");
    expect(sellLayoutFor(900)).toBe("split");
    expect(sellLayoutFor(899)).toBe("stacked");
    expect(sellLayoutFor(390)).toBe("stacked");
  });

  it("tile columns fit the pane (124 dp tiles, 10 dp gaps), never fewer than 2", () => {
    expect(tileColumns(860)).toBe(6); // 1366 laptop, grid pane
    expect(tileColumns(780)).toBe(5); // 1280 tablet
    expect(tileColumns(300)).toBe(2);
    expect(tileColumns(10)).toBe(2);
  });
});
