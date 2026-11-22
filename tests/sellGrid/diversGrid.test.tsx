import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { ProductGrid } from "../../src/components/sell/ProductGrid";
import { resolveGrid, type GridProduct } from "../../src/lib/sellGrid/layout";
import { allTexts } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "fr" },
  }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

const P = (id: string, name: string, category: string): GridProduct => ({
  id,
  name,
  barcode: null,
  category_id: category,
  unit: "piece",
  selling_price_cents: 700,
  stock_quantity: 9,
  low_stock_threshold: 2,
  active: true,
});
const tab = (
  id: string,
  category: string | null,
  kind: "favorites" | "category",
  position: number
) => ({
  id,
  kind,
  category_id: category,
  label: null,
  position,
  visible: true,
  auto_fill: kind === "category",
});

const tabs = resolveGrid({
  tabs: [
    tab("fav", null, "favorites", 0),
    tab("t1", "c1", "category", 1),
    tab("t2", "c2", "category", 2),
  ],
  tiles: [
    {
      id: "r1",
      tab_id: "fav",
      product_id: "a",
      position: 0,
      hidden: false,
      pinned: true,
      color: null,
      short_label: null,
    },
  ],
  categories: [
    { id: "c1", name: "Boissons" },
    { id: "c2", name: "Boulangerie" },
  ],
  favoritesLabel: "Favoris",
  products: [P("a", "Coca", "c1"), P("b", "Eau", "c1"), P("c", "Pain", "c2")],
});

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

// Every tappable tile in the order it is drawn (tabs and the arrange button excluded).
const tileButtons = (root: ReactTestInstance) =>
  root.findAll(
    (n) =>
      typeof n.type !== "string" &&
      n.props.accessibilityRole === "button" &&
      typeof n.props.onPress === "function" &&
      typeof n.props.accessibilityLabel === "string"
  );
const selectTab = (label: string) => {
  const t = tree.root
    .findAll((n) => n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function")
    .find((n) => allTexts(n).some((x) => x.includes(label)))!;
  act(() => t.props.onPress());
};

describe("the Divers tile", () => {
  it("is the first tile of every tab", () => {
    const onDivers = jest.fn();
    act(() => {
      tree = create(
        <ProductGrid
          tabs={tabs}
          inCart={{}}
          onAdd={() => {}}
          divers={{ count: 0, onPress: onDivers }}
        />
      );
    });
    for (const label of ["Favoris", "Boissons", "Boulangerie"]) {
      selectTab(label);
      const first = tileButtons(tree.root)[0];
      expect(first.props.testID).toBe("divers-tile");
      expect(allTexts(first).join("")).toContain("sell.diversTile");
    }
    act(() => tileButtons(tree.root)[0].props.onPress());
    expect(onDivers).toHaveBeenCalledTimes(1);
  });

  it("is first even when the owner pinned a product on that tab", () => {
    act(() => {
      tree = create(
        <ProductGrid
          tabs={tabs}
          inCart={{}}
          onAdd={() => {}}
          divers={{ count: 0, onPress: () => {} }}
        />
      );
    });
    selectTab("Favoris");
    const buttons = tileButtons(tree.root);
    expect(buttons[0].props.testID).toBe("divers-tile");
    expect(
      buttons.filter((n) => n.props.testID !== "divers-tile")[0].props.accessibilityLabel
    ).toContain("Coca");
  });

  it("shows how many Divers lines are in the basket", () => {
    act(() => {
      tree = create(
        <ProductGrid
          tabs={tabs}
          inCart={{}}
          onAdd={() => {}}
          divers={{ count: 3, onPress: () => {} }}
        />
      );
    });
    expect(allTexts(tree.root.findByProps({ testID: "divers-qty-badge" }))).toEqual(["×3"]);
  });

  it("is absent when the device does not know the Divers product", () => {
    act(() => {
      tree = create(<ProductGrid tabs={tabs} inCart={{}} onAdd={() => {}} divers={null} />);
    });
    expect(tree.root.findAllByProps({ testID: "divers-tile" })).toHaveLength(0);
    expect(allTexts(tree.root).join("|")).not.toContain("sell.diversTile");
    act(() => tree.unmount());
    act(() => {
      tree = create(<ProductGrid tabs={tabs} inCart={{}} onAdd={() => {}} />);
    });
    expect(tree.root.findAllByProps({ testID: "divers-tile" })).toHaveLength(0);
  });

  it("is not a product of the resolved grid, so arranging can never move or hide it", () => {
    const ids = tabs.flatMap((t) => t.tiles.map((x) => x.product.id));
    expect(ids).not.toContain("divers-id");
    expect(ids.sort()).toEqual(["a", "a", "b", "c"].sort());
  });
});
