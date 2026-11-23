import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { DiversTile, ProductGrid, Tile } from "../../src/components/sell/ProductGrid";
import type { GridProduct, ResolvedTile } from "../../src/lib/sellGrid/layout";
import { allTexts } from "../sales/sellTestUtils";

let mockUrl: string | null = null;
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "fr" },
  }),
}));
jest.mock("../../src/lib/products/photoUrls", () => ({
  usePhotoUrl: (path: string | null) => (path ? mockUrl : null),
}));

const product = (extra: Partial<GridProduct> = {}): GridProduct => ({
  id: "a",
  name: "Coca-Cola 33cl",
  barcode: null,
  category_id: "c1",
  unit: "piece",
  selling_price_cents: 700,
  stock_quantity: 9,
  low_stock_threshold: 2,
  active: true,
  ...extra,
});
const tileOf = (p: GridProduct): ResolvedTile => ({
  key: p.id,
  product: p,
  label: p.name,
  color: null,
});

let tree: ReactTestRenderer;
const render = (el: React.ReactElement) => {
  act(() => {
    tree = create(el);
  });
};
afterEach(() => act(() => tree?.unmount()));
const photos = () =>
  tree.root.findAllByProps({ testID: "tile-photo" }).filter((n) => typeof n.type === "string");
const nameLines = () =>
  tree.root.findAll(
    (n) =>
      typeof n.type === "string" &&
      n.props.numberOfLines !== undefined &&
      typeof n.props.children === "string" &&
      n.props.children.includes("Coca")
  );

it("a tile with a photo shows it, keeps the name, price, basket badge and stock badge", () => {
  mockUrl = "https://x/a.jpg";
  render(
    <Tile
      tile={tileOf(product({ photo_path: "a/1.jpg" }))}
      width={140}
      count={3}
      onPress={() => {}}
    />
  );
  expect(photos()).toHaveLength(1);
  expect(photos()[0].props.source).toEqual({ uri: "https://x/a.jpg" });
  const texts = allTexts(tree.root).join("|");
  expect(texts).toContain("Coca-Cola 33cl");
  expect(texts).toContain("7.00");
  expect(texts).toContain("×3");
  expect(texts).toContain("9");
  expect(tree.root.findAllByProps({ testID: "tile-qty-badge" }).length).toBeGreaterThan(0);
  // The full name stays readable next to the photo (up to three lines).
  expect(nameLines()[0].props.numberOfLines).toBe(3);
});

it("the same tile without a photo is drawn as before (two-line name, no image)", () => {
  mockUrl = null;
  render(
    <Tile tile={tileOf(product({ photo_path: null }))} width={140} count={0} onPress={() => {}} />
  );
  expect(photos()).toHaveLength(0);
  expect(nameLines()[0].props.numberOfLines).toBe(2);
});

it("a photo path whose URL is not known (offline, never loaded) draws no photo", () => {
  mockUrl = null;
  render(
    <Tile
      tile={tileOf(product({ photo_path: "a/1.jpg" }))}
      width={140}
      count={0}
      onPress={() => {}}
    />
  );
  expect(photos()).toHaveLength(0);
});

it("a photo that fails to load disappears and the tile goes back to its plain look", () => {
  mockUrl = "https://x/gone.jpg";
  render(
    <Tile
      tile={tileOf(product({ photo_path: "a/1.jpg" }))}
      width={140}
      count={0}
      onPress={() => {}}
    />
  );
  act(() => photos()[0].props.onError());
  expect(photos()).toHaveLength(0);
  expect(nameLines()[0].props.numberOfLines).toBe(2);
});

it("a tile is still one tappable button with the same label", () => {
  mockUrl = "https://x/a.jpg";
  const onPress = jest.fn();
  render(
    <Tile
      tile={tileOf(product({ photo_path: "a/1.jpg" }))}
      width={140}
      count={0}
      onPress={onPress}
    />
  );
  const button = tree.root.find(
    (n) =>
      typeof n.type !== "string" &&
      n.props.accessibilityRole === "button" &&
      typeof n.props.onPress === "function"
  );
  expect(button.props.accessibilityLabel).toContain("Coca-Cola 33cl");
  act(() => button.props.onPress());
  expect(onPress).toHaveBeenCalled();
});

it("the Divers tile never has a photo", () => {
  mockUrl = "https://x/a.jpg";
  render(<DiversTile width={140} count={0} onPress={() => {}} />);
  expect(photos()).toHaveLength(0);
  expect(tree.root.findAllByType("Image" as never)).toHaveLength(0);
});

it("in the grid, only tiles with a photo path show one", () => {
  mockUrl = "https://x/a.jpg";
  const tabs = [
    {
      id: "t",
      kind: "category" as const,
      label: "Boissons",
      categoryId: "c1",
      tiles: [
        tileOf(product({ id: "a", photo_path: "a/1.jpg" })),
        tileOf(product({ id: "b", name: "Eau", photo_path: null })),
      ],
    },
  ];
  render(
    <ProductGrid
      tabs={tabs}
      inCart={{}}
      onAdd={() => {}}
      divers={{ count: 0, onPress: () => {} }}
    />
  );
  expect(photos()).toHaveLength(1);
});
