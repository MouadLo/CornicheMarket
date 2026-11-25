import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import NewScreen from "../../app/(app)/webstore/new";
import { createWebProduct, fetchWebCategories } from "../../src/lib/webstore/queries";
import { appProduct, categories, findPressable, hasText } from "./helpers";

jest.setTimeout(15_000);

let mockRole: "owner" | "cashier" = "owner";
const mockReplace = jest.fn();
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    router: { replace: (...a: unknown[]) => mockReplace(...a) },
    Redirect: ({ href }: { href: string }) => React.createElement("Redirect", { href }),
  };
});
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u", role: mockRole } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/components/stock/ProductSearchPicker", () => {
  const React = require("react");
  return { ProductSearchPicker: (p: object) => React.createElement("Picker", p) };
});
jest.mock("../../src/lib/webstore/queries", () => ({
  fetchWebCategories: jest.fn(),
  createWebProduct: jest.fn(),
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<NewScreen />);
  });
};
const press = async (label: string) => {
  await act(async () => {
    await findPressable(tree.root, label).props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  jest.mocked(fetchWebCategories).mockResolvedValue(categories);
  jest.mocked(createWebProduct).mockResolvedValue("p068");
});
afterEach(() => act(() => tree.unmount()));

it("a cashier is sent back to Vente", async () => {
  mockRole = "cashier";
  await render();
  expect(tree.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
});

it("from an app product: copies its name, links it, then opens the edit screen", async () => {
  await render();
  const picker = tree.root.findByType("Picker" as never);
  await act(async () =>
    picker.props.onPick({ ...appProduct({ id: "a7", name: "Eau 1L" }), barcode: null })
  );
  await press("Boissons");
  await press("webstore.newCreate");
  expect(createWebProduct).toHaveBeenCalledWith({
    name: "Eau 1L",
    name_fr: "Eau 1L",
    category_id: "drinks",
    product_id: "a7",
  });
  expect(mockReplace).toHaveBeenCalledWith("/(app)/webstore/p068");
});

it("a category and a product are required", async () => {
  await render();
  await press("webstore.newCreate");
  expect(hasText(tree.root, "webstore.newNeedProduct")).toBe(true);
  const picker = tree.root.findByType("Picker" as never);
  await act(async () => picker.props.onPick({ ...appProduct(), barcode: null }));
  await press("webstore.newCreate");
  expect(hasText(tree.root, "webstore.newNeedCategory")).toBe(true);
  expect(createWebProduct).not.toHaveBeenCalled();
});

it("a free product is not linked and needs a name", async () => {
  await render();
  await press("webstore.newFree");
  await press("Snacks");
  await press("webstore.newCreate");
  expect(hasText(tree.root, "webstore.newNeedName")).toBe(true);
  const name = tree.root.findAllByProps({ label: "webstore.newName" })[0];
  act(() => name.props.onChangeText(" Bougie "));
  await press("webstore.newCreate");
  expect(createWebProduct).toHaveBeenCalledWith({
    name: "Bougie",
    name_fr: "Bougie",
    category_id: "snacks",
    product_id: null,
  });
});

it("a failed creation shows an error and stays", async () => {
  jest.mocked(createWebProduct).mockRejectedValue(new Error("boom"));
  await render();
  await press("webstore.newFree");
  await press("Snacks");
  const name = tree.root.findAllByProps({ label: "webstore.newName" })[0];
  act(() => name.props.onChangeText("X"));
  await press("webstore.newCreate");
  expect(mockReplace).not.toHaveBeenCalled();
  expect(hasText(tree.root, "errors.generic")).toBe(true);
});
