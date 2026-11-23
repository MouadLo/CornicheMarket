import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { fetchCompetitorRows } from "../../src/lib/competitors/queries";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

import EditProduct from "../../app/(app)/products/[id]";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => ({ id: "p1" }),
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const t = (key: string, values?: object) => key + (values ? JSON.stringify(values) : "");
  const value = { t, i18n: { language: "fr" } };
  return { useTranslation: () => value };
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: "owner" } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/components/products/ProductForm", () => ({
  ProductForm: () => {
    const React = require("react");
    return React.createElement("ProductForm");
  },
}));
jest.mock("../../src/components/competitors/CompetitorSection", () => ({
  CompetitorSection: () => {
    const React = require("react");
    return React.createElement("CompetitorSection");
  },
}));
jest.mock("../../src/lib/products/useUnsavedGuard", () => ({ useUnsavedGuard: () => jest.fn() }));
jest.mock("../../src/lib/products/categories", () => ({ mainCategoryId: () => null }));
jest.mock("../../src/lib/sellGrid/queries", () => ({
  fetchProductTileSettings: jest.fn().mockResolvedValue(undefined),
  saveProductTileSettings: jest.fn(),
}));
jest.mock("../../src/lib/sellGrid/refresh", () => ({ refreshGridCache: jest.fn() }));
jest.mock("../../src/lib/competitors/queries", () => ({ fetchCompetitorRows: jest.fn() }));
jest.mock("../../src/lib/products/queries", () => ({
  fetchCategories: jest.fn().mockResolvedValue([]),
  fetchProduct: jest.fn().mockResolvedValue({ id: "p1", name: "Chips" }),
  updateProduct: jest.fn(),
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<EditProduct />);
  });
};
afterEach(() => act(() => tree.unmount()));

it("no longer renders the competitor section on the product page", async () => {
  jest.mocked(fetchCompetitorRows).mockResolvedValue([]);
  await render();
  expect(tree.root.findAllByType("ProductForm" as never)).toHaveLength(1);
  expect(tree.root.findAllByType("CompetitorSection" as never)).toHaveLength(0);
  expect(allTexts(tree.root).join("|")).not.toContain("products.trackedAt");
});

it("shows a small link to the competitor page when the product is tracked", async () => {
  jest.mocked(fetchCompetitorRows).mockResolvedValue([{}, {}] as never);
  await render();
  expect(allTexts(tree.root).join("|")).toContain('products.trackedAt{"count":2}');
  expect(tree.root.findAllByType("CompetitorSection" as never)).toHaveLength(0);
  await act(async () => pressableByText(tree.root, "products.trackedSee").props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/(app)/competitors/p1");
});
