import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ProductRow } from "../../src/components/products/ProductRow";
import type { Product } from "../../src/lib/products/queries";

let mockUrl: string | null = null;
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "fr" } }),
}));
jest.mock("../../src/lib/products/photoUrls", () => ({
  usePhotoUrl: (path: string | null) => (path ? mockUrl : null),
}));

const product = (extra: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Sidi Ali 50cl",
  barcode: null,
  category_id: null,
  unit: "piece",
  selling_price_cents: 300,
  stock_quantity: 4,
  low_stock_threshold: 1,
  is_low_stock: false,
  active: true,
  current_cost_cents: null,
  ...extra,
});

let tree: ReactTestRenderer;
const render = (p: Product) => {
  act(() => {
    tree = create(<ProductRow product={p} showCost={false} />);
  });
};
afterEach(() => act(() => tree.unmount()));

it("shows a 40 px thumbnail when the photo URL is known", () => {
  mockUrl = "https://x/p1/a.jpg?t=1";
  render(product({ photo_path: "p1/a.jpg" }));
  const image = tree.root.findByProps({ testID: "product-photo" });
  expect(image.props.source).toEqual({ uri: "https://x/p1/a.jpg?t=1" });
  expect(image.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ width: 40, height: 40 })])
  );
});

it("shows the placeholder without a photo, or while its URL is unknown (offline)", () => {
  mockUrl = null;
  render(product({ photo_path: null }));
  expect(tree.root.findAllByProps({ testID: "product-photo" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "product-photo-placeholder" }).length).toBeGreaterThan(
    0
  );
  act(() => tree.unmount());
  render(product({ photo_path: "p1/a.jpg" }));
  expect(tree.root.findAllByProps({ testID: "product-photo-placeholder" }).length).toBeGreaterThan(
    0
  );
});

it("a photo that fails to load falls back to the placeholder", () => {
  mockUrl = "https://x/gone.jpg";
  render(product({ photo_path: "p1/a.jpg" }));
  act(() => {
    tree.root.findByProps({ testID: "product-photo" }).props.onError();
  });
  expect(tree.root.findAllByProps({ testID: "product-photo" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "product-photo-placeholder" }).length).toBeGreaterThan(
    0
  );
});
