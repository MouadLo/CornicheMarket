import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { confirmMatch } from "../../src/lib/competitors/shops";
import { showToast } from "../../src/lib/dialog/store";
import { createProduct } from "../../src/lib/products/queries";

import { resetOrigin, trackLocation } from "../../src/lib/nav/origin";

import NewProduct from "../../app/(app)/products/new";

let mockParams: Record<string, string> = {};
let mockRole = "owner";
const mockBack = jest.fn();
const mockNavigate = jest.fn();
let mockFormProps: { initialName?: string; onSubmit: (input: object, tile: null) => Promise<void> };

let mockStackIndex = 1;
jest.mock("expo-router", () => ({
  useNavigation: () => ({ getState: () => ({ index: mockStackIndex }) }),
  usePathname: () => "/products/new",
  router: { back: () => mockBack(), navigate: (to: unknown) => mockNavigate(to) },
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    const React = require("react");
    return React.createElement("Redirect", { href });
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "fr" } }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u", role: mockRole } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/dialog/store", () => ({ showToast: jest.fn(), confirm: jest.fn() }));
jest.mock("../../src/lib/competitors/shops", () => ({ confirmMatch: jest.fn() }));
jest.mock("../../src/lib/products/useUnsavedGuard", () => ({ useUnsavedGuard: () => jest.fn() }));
jest.mock("../../src/lib/products/queries", () => ({
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  fetchCategories: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../src/lib/sellGrid/queries", () => ({ saveProductTileSettings: jest.fn() }));
jest.mock("../../src/lib/sellGrid/refresh", () => ({ refreshGridCache: jest.fn() }));
jest.mock("../../src/components/products/ProductForm", () => ({
  ProductForm: (props: typeof mockFormProps) => {
    mockFormProps = props;
    return null;
  },
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<NewProduct />);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockStackIndex = 1;
  resetOrigin();
  mockRole = "owner";
  jest.mocked(createProduct).mockResolvedValue("new-product");
  jest.mocked(confirmMatch).mockResolvedValue("link");
});
afterEach(() => act(() => tree.unmount()));

it("starts from the competitor item's name and links the item once the product is saved", async () => {
  mockParams = { competitorItemId: "item-1", name: "Lorenz Crunchips Paprika" };
  await render();
  expect(mockFormProps.initialName).toBe("Lorenz Crunchips Paprika");
  await act(async () => {
    await mockFormProps.onSubmit({}, null);
  });
  expect(createProduct).toHaveBeenCalledTimes(1);
  expect(confirmMatch).toHaveBeenCalledWith("item-1", "new-product");
  expect(mockBack).toHaveBeenCalled();
  // Back to the À sourcer tab, not the products list.
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: "/(app)/competitors",
    params: { tab: "sourcing", r: expect.any(String) },
  });
});

it("a failed link still keeps the product and says so", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  jest.mocked(confirmMatch).mockRejectedValue(new Error("boom"));
  await render();
  await act(async () => {
    await mockFormProps.onSubmit({}, null);
  });
  expect(showToast).toHaveBeenCalledWith(
    expect.objectContaining({ text: "competitors.sourcingTab.linkFailed" })
  );
  expect(mockBack).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalled();
});

it("without a competitor item nothing is linked", async () => {
  await render();
  expect(mockFormProps.initialName).toBeUndefined();
  await act(async () => {
    await mockFormProps.onSubmit({}, null);
  });
  expect(confirmMatch).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it("a cashier is sent back", async () => {
  mockRole = "cashier";
  await render();
  expect(tree.root.findAllByType("Redirect" as never)[0].props.href).toBe("/(app)/products");
});

it("opened from another section (alone in its stack): Créer le produit goes straight to À sourcer", async () => {
  mockStackIndex = 0;
  mockParams = { competitorItemId: "item-1", name: "X" };
  await render();
  await act(async () => {
    await mockFormProps.onSubmit({}, null);
  });
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: "/(app)/competitors",
    params: { tab: "sourcing", r: expect.any(String) },
  });
});

it("opened from another section: Save returns to where the owner came from", async () => {
  mockStackIndex = 0;
  trackLocation("/sell");
  trackLocation("/products/new");
  await render();
  await act(async () => {
    await mockFormProps.onSubmit({}, null);
  });
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/sell");
});

it("opened from the products list: Save is a plain back, whatever the origin", async () => {
  trackLocation("/sell");
  trackLocation("/products");
  trackLocation("/products/new");
  await render();
  await act(async () => {
    await mockFormProps.onSubmit({}, null);
  });
  expect(mockBack).toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});
