/**
 * The products list: a failed read is a failure with a Retry, never an empty
 * catalog; an empty catalog offers "add your first product" to the owner only.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ProductsScreen from "../../app/(app)/products/index";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

let mockRole: "owner" | "cashier" = "owner";
const mockFetchProducts = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    React.useEffect(cb, [cb]);
  },
}));
jest.mock("react-i18next", () => {
  const t = (key: string) => key;
  const value = { t, i18n: { language: "fr" } };
  return { useTranslation: () => value };
});
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: mockRole } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/files", () => ({ saveTextFile: jest.fn() }));
jest.mock("../../src/lib/products/queries", () => ({
  ...jest.requireActual("../../src/lib/products/queries"),
  fetchProducts: (...a: unknown[]) => mockFetchProducts(...a),
  fetchCategories: async () => [],
  fetchAllProducts: async () => [],
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<ProductsScreen />);
  });
};
const texts = () => allTexts(tree.root);

beforeEach(() => {
  mockRole = "owner";
  mockFetchProducts.mockReset();
  mockPush.mockReset();
});
afterEach(() => act(() => tree.unmount()));

it("a failed load shows the error and Retry, not an empty catalog", async () => {
  mockFetchProducts.mockRejectedValue(new TypeError("Failed to fetch"));
  await render();
  const shown = texts();
  expect(shown).toContain("products.loadError");
  expect(shown.join(" ")).toContain("errors.network");
  expect(shown).not.toContain("products.emptyTitle");
  expect(shown).not.toContain("products.empty");
  expect(shown.join(" ")).not.toContain("Failed to fetch");
  expect(shown).toContain("common.retry");

  // Retry reads again, and a good answer replaces the error.
  mockFetchProducts.mockResolvedValue([]);
  await act(async () => {
    pressableByText(tree.root, "common.retry").props.onPress();
  });
  expect(texts()).not.toContain("products.loadError");
  expect(texts()).toContain("products.emptyTitle");
});

it("unknown server text becomes the generic message, never the raw text", async () => {
  mockFetchProducts.mockRejectedValue(new Error('relation "products" does not exist'));
  await render();
  expect(texts().join(" ")).not.toContain("relation");
  expect(texts().join(" ")).toContain("states.loadErrorHint");
});

it("an empty catalog offers the owner a first product", async () => {
  mockFetchProducts.mockResolvedValue([]);
  await render();
  expect(texts()).toContain("products.emptyTitle");
  expect(texts()).toContain("products.emptyHintOwner");
  await act(async () => {
    pressableByText(tree.root, "products.emptyAddFirst").props.onPress();
  });
  expect(mockPush).toHaveBeenCalledWith("/(app)/products/new");
});

it("a cashier is never offered the owner's action", async () => {
  mockRole = "cashier";
  mockFetchProducts.mockResolvedValue([]);
  await render();
  expect(texts()).toContain("products.emptyHintCashier");
  expect(texts()).not.toContain("products.emptyAddFirst");
  expect(texts()).not.toContain("products.addNew");
});

describe("on a phone", () => {
  it("keeps secondary actions and filters closed until asked for", async () => {
    mockFetchProducts.mockResolvedValue([]);
    await render();
    expect(texts()).toContain("products.addNew");
    expect(texts()).not.toContain("products.importCsv");
    expect(texts()).not.toContain("products.allCategories");

    await act(async () => {
      pressableByText(tree.root, "products.moreActions").props.onPress();
    });
    expect(texts()).toContain("products.importCsv");
    expect(texts()).toContain("products.manageCategories");
  });

  it("names an active filter on the list and clears it", async () => {
    mockFetchProducts.mockResolvedValue([]);
    await render();
    await act(async () => {
      pressableByText(tree.root, "products.filters").props.onPress();
    });
    await act(async () => {
      pressableByText(tree.root, "products.lowStock").props.onPress();
    });
    await act(async () => {
      pressableByText(tree.root, "products.showResults").props.onPress();
    });
    expect(texts()).toContain("products.lowStock");
    expect(mockFetchProducts.mock.calls.at(-1)?.[0]).toMatchObject({ lowStockOnly: true });

    await act(async () => {
      pressableByText(tree.root, "products.clearShort").props.onPress();
    });
    expect(texts()).not.toContain("products.lowStock");
    expect(mockFetchProducts.mock.calls.at(-1)?.[0]).toMatchObject({ lowStockOnly: false });
  });

  it("gives a cashier the filters but no owner actions", async () => {
    mockRole = "cashier";
    mockFetchProducts.mockResolvedValue([]);
    await render();
    expect(texts()).toContain("products.filters");
    expect(texts()).not.toContain("products.moreActions");
  });
});

it("offers recent price changes to the owner, never to a cashier", async () => {
  mockFetchProducts.mockResolvedValue([]);
  await render();
  // On a narrow screen the actions sit behind "more".
  await act(async () => {
    pressableByText(tree.root, "products.moreActions").props.onPress();
  });
  expect(texts()).toContain("products.priceChangesRecent");
  await act(() => tree.unmount());

  mockRole = "cashier";
  await render();
  expect(texts()).not.toContain("products.moreActions");
  expect(texts()).not.toContain("products.priceChangesRecent");
});
