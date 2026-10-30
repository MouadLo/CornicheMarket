import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import StockCountScreen from "../../app/(app)/stock-in/count";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";

const catalog = [
  {
    id: "milk",
    name: "Milk 1L",
    barcode: "6111234567890",
    unit: "piece",
    selling_price_cents: 700,
  },
  {
    id: "pack",
    name: "Pack 6111234",
    barcode: "9990000000017",
    unit: "piece",
    selling_price_cents: 900,
  },
];

jest.mock("react-i18next", () => {
  const t = (key: string, options?: { name?: string; barcode?: string }) =>
    options?.barcode ? `${key}:${options.barcode}` : options?.name ? `${key}:${options.name}` : key;
  return { useTranslation: () => ({ t }) };
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "owner", role: "owner" } }),
}));
jest.mock("../../src/lib/inventory/queries", () => ({ applyStockCount: jest.fn() }));
jest.mock("../../src/lib/products/queries", () => ({
  // The server search is fuzzy: name contains OR barcode starts with.
  fetchProducts: async ({ search }: { search: string }) =>
    catalog.filter((p) => p.name.includes(search) || p.barcode.startsWith(search)),
  fetchProductByBarcode: async (code: string) => catalog.find((p) => p.barcode === code) ?? null,
}));
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: () => null,
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));

let tree: ReactTestRenderer;
beforeEach(async () => {
  await act(async () => {
    tree = create(<StockCountScreen />);
  });
});
afterEach(() => act(() => tree.unmount()));

async function scan(code: string): Promise<string | null> {
  let message: string | null = null;
  await act(async () => {
    message = (await tree.root.findByType(ContinuousScanner).props.onScanned(code)).message;
  });
  return message;
}

const allTexts = (root: ReactTestRenderer["root"]) =>
  root.findAllByType(Text).map((node) => [node.props.children].flat(Infinity).join(""));

const countedNames = () =>
  allTexts(tree.root).filter((text) => text.includes("Milk") || text.includes("Pack"));

it("an exact barcode adds that product to the count", async () => {
  expect(await scan("6111234567890")).toBe("stockIn.countAdded:Milk 1L");
  expect(countedNames().some((text) => text.includes("Milk 1L"))).toBe(true);
});

it("a partial barcode (prefix of a real one) never selects a product", async () => {
  expect(await scan("611123456789")).toBe("stockIn.countUnknown:611123456789");
  expect(countedNames()).toEqual([]);
});

it("digits that appear in a product NAME do not select that product", async () => {
  expect(await scan("6111234")).toBe("stockIn.countUnknown:6111234");
  expect(countedNames()).toEqual([]);
});
