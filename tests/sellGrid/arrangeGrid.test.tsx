import React from "react";
import { Pressable } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { ArrangeGrid } from "../../src/components/sell/ArrangeGrid";
import { allTexts, pressableByText } from "../sales/sellTestUtils";
import { resolveArrangeTabs } from "../../src/lib/sellGrid/arrange";
import type { GridProduct, GridTab, GridTile } from "../../src/lib/sellGrid/layout";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
    i18n: { language: "fr" },
  }),
}));

const product = (id: string, name: string, category: string): GridProduct => ({
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
  position: number
): GridTab => ({
  id,
  kind,
  category_id: category,
  label: null,
  position,
  visible: true,
  auto_fill: kind === "category",
});
const row = (tab_id: string, product_id: string, position: number): GridTile => ({
  id: `${tab_id}-${product_id}`,
  tab_id,
  product_id,
  position,
  hidden: false,
  pinned: false,
  color: null,
  short_label: null,
});

const initial = resolveArrangeTabs({
  tabs: [tab("fav", "favorites", null, 0), tab("t-fruit", "category", "fruit", 1)],
  tiles: [row("fav", "b", 0), row("fav", "a", 1)],
  products: [
    product("a", "Apple", "fruit"),
    product("b", "Banana", "fruit"),
    product("c", "Cherry", "fruit"),
  ],
  categories: [{ id: "fruit", name: "Fruit" }],
  favoritesLabel: "Favoris",
});

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

function byLabel(label: string): ReactTestInstance {
  const found = tree.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function"
  );
  if (found.length === 0) throw new Error(`no button labelled "${label}"`);
  return found[0];
}
const tabButtons = () =>
  tree.root.findAllByType(Pressable).filter((n) => n.props.accessibilityRole === "tab");
const press = (label: string) => act(() => byLabel(label).props.onPress());
const pressText = async (text: string) => {
  const node = pressableByText(tree.root, text);
  await act(async () => {
    node.props.onPress();
  });
};

function render(overrides: Partial<React.ComponentProps<typeof ArrangeGrid>> = {}) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  act(() => {
    tree = create(
      <ArrangeGrid initial={initial} onSave={onSave} onClose={onClose} {...overrides} />
    );
  });
  return { onSave, onClose };
}

describe("arrange mode", () => {
  it("shows the banner and the same tiles, and a tap on a tile does nothing", () => {
    render();
    const texts = allTexts(tree.root).join("|");
    expect(texts).toContain("sell.grid.arrangeBanner");
    const tileButtons = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "sell.grid.tileLabelEmpty:Banana"
    );
    expect(tileButtons.length).toBeGreaterThan(0);
    for (const node of tileButtons) expect(node.props.onPress).toBeUndefined();
  });

  it("move later reorders, and Terminer saves the payload once", async () => {
    const { onSave, onClose } = render();
    press("sell.grid.moveLater:Banana");
    await pressText("sell.grid.arrangeDone");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].tiles).toEqual([
      { tab_id: "fav", product_id: "a", position: 0, hidden: false },
      { tab_id: "fav", product_id: "b", position: 1, hidden: false },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("Annuler discards the changes without saving", async () => {
    const { onSave, onClose } = render();
    press("sell.grid.moveLater:Banana");
    await pressText("sell.grid.arrangeCancel");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Terminer with no change just leaves", async () => {
    const { onSave, onClose } = render();
    await pressText("sell.grid.arrangeDone");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("hides a tile: it goes last, dimmed, and is saved as hidden", async () => {
    const { onSave } = render();
    press("sell.grid.hideTile:Banana");
    // Shown again by its toggle, now labelled "show".
    expect(byLabel("sell.grid.showTile:Banana")).toBeDefined();
    await pressText("sell.grid.arrangeDone");
    expect(onSave.mock.calls[0][0].tiles).toEqual([
      { tab_id: "fav", product_id: "a", position: 0, hidden: false },
      { tab_id: "fav", product_id: "b", position: 1, hidden: true },
    ]);
  });

  it("keeps pending changes of a tab when switching tabs", async () => {
    const { onSave } = render();
    press("sell.grid.moveLater:Banana");
    await act(async () => {
      tabButtons()[1].props.onPress();
    });
    // Category tab: Cherry earlier.
    press("sell.grid.moveEarlier:Cherry");
    await pressText("sell.grid.arrangeDone");
    const payload = onSave.mock.calls[0][0];
    expect(payload.tiles.filter((t: { tab_id: string }) => t.tab_id === "fav")).toHaveLength(2);
    expect(
      payload.tiles
        .filter((t: { tab_id: string }) => t.tab_id === "t-fruit")
        .map((t: { product_id: string }) => t.product_id)
    ).toEqual(["a", "c", "b"]);
  });

  it("hides and shows a tab, but never the last visible one", async () => {
    const { onSave } = render();
    press("sell.grid.hideTab:Favoris");
    await act(async () => {
      tabButtons()[1].props.onPress();
    });
    // The category tab is now the only visible one: hiding it is refused.
    press("sell.grid.hideTab:Fruit");
    expect(allTexts(tree.root).join("|")).toContain("sell.grid.keepOneTab");
    expect(byLabel("sell.grid.hideTab:Fruit")).toBeDefined();
    await pressText("sell.grid.arrangeDone");
    expect(onSave.mock.calls[0][0].tabs).toEqual([
      { id: "fav", position: 0, visible: false },
      { id: "t-fruit", position: 1, visible: true },
    ]);
  });

  it("moves a tab earlier or later", async () => {
    const { onSave } = render();
    press("sell.grid.tabLater:Favoris");
    await pressText("sell.grid.arrangeDone");
    expect(onSave.mock.calls[0][0].tabs.map((t: { id: string }) => t.id)).toEqual([
      "t-fruit",
      "fav",
    ]);
  });

  it("a failed save stays in arrange mode and says why", async () => {
    const { onSave, onClose } = render({
      onSave: jest.fn().mockRejectedValue({ message: "Failed to fetch" }),
    });
    void onSave;
    press("sell.grid.moveLater:Banana");
    await pressText("sell.grid.arrangeDone");
    expect(onClose).not.toHaveBeenCalled();
    expect(allTexts(tree.root).join("|")).toContain("errors.network");
    // The owner's changes are still there.
    expect(byLabel("sell.grid.moveEarlier:Banana")).toBeDefined();
  });
});
