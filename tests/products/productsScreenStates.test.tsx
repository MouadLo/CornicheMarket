/**
 * The products list: a failed read is a failure with a Retry, never an empty
 * catalog; an empty catalog offers "add your first product" to the owner only.
 */
import React from "react";
import { FlatList } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ProductRow } from "../../src/components/products/ProductRow";
import { clearPlace, peekPlace, rememberPlace } from "../../src/lib/products/listPlace";
import { PAGE_SIZE } from "../../src/lib/products/queries";

import ProductsScreen from "../../app/(app)/products/index";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

let mockRole: "owner" | "cashier" = "owner";
const mockFetchProducts = jest.fn();
const mockFetchProduct = jest.fn();
const mockPush = jest.fn();
const focusCallbacks: (() => void)[] = [];

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    React.useEffect(() => {
      focusCallbacks.push(cb);
      return cb();
    }, [cb]);
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
  fetchProduct: (...a: unknown[]) => mockFetchProduct(...a),
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
  mockFetchProduct.mockReset();
  focusCallbacks.length = 0;
  clearPlace();
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
  expect(texts()).not.toContain("products.competitorPrices");
});

it("the product tools no longer link to the competitor screen (it is its own section)", async () => {
  mockFetchProducts.mockResolvedValue([]);
  await render();
  await act(async () => {
    pressableByText(tree.root, "products.moreActions").props.onPress();
  });
  expect(texts()).not.toContain("products.competitorPrices");
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

describe("keeping the owner's place", () => {
  const product = (n: number, name = `Produit ${n}`) => ({
    id: `p-${n}`,
    name,
    barcode: null,
    unit: "piece",
    stock_quantity: 3,
    selling_price_cents: 500,
    current_cost_cents: 300,
    active: true,
    is_low_stock: false,
  });
  const page = (from: number, count = PAGE_SIZE) =>
    Array.from({ length: count }, (_, i) => product(from + i));
  // ProductRow is memo(): its instances show up as the inner component.
  const rows = () =>
    tree.root.findAll((n) => n.type === (ProductRow as unknown as { type: unknown }).type);
  const names = () => rows().map((r) => r.props.product.name);
  const waitForScroll = () => act(async () => void (await new Promise((r) => setTimeout(r, 120))));

  it("tapping a row remembers the product, the pages loaded and the filters", async () => {
    mockFetchProducts.mockResolvedValue(page(0));
    await render();
    await act(async () => {
      rows()[3].props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith("/(app)/products/p-3");
    expect(peekPlace()).toMatchObject({ productId: "p-3", index: 3, loadedPages: 0 });
  });

  it("after a remount it reloads down to the page, restores filters and scrolls to the row", async () => {
    const scroll = jest.spyOn(FlatList.prototype, "scrollToIndex").mockImplementation(() => {});
    rememberPlace({
      productId: `p-${PAGE_SIZE + 4}`,
      index: PAGE_SIZE + 4,
      loadedPages: 1,
      filters: {
        search: "lait",
        categoryId: null,
        subCategoryId: null,
        lowStockOnly: true,
        status: "all",
      },
    });
    mockFetchProducts.mockImplementation(async (_f: unknown, pageIndex: number) =>
      page(pageIndex * PAGE_SIZE)
    );
    await render();
    await waitForScroll();

    const calls = mockFetchProducts.mock.calls;
    expect(calls.map((c) => c[1])).toEqual([0, 1]);
    expect(calls[0][0]).toMatchObject({ search: "lait", lowStockOnly: true, status: "all" });
    const list = tree.root.findByType(FlatList);
    expect(list.props.data).toHaveLength(PAGE_SIZE * 2);
    expect(list.props.extraData).toBe(`p-${PAGE_SIZE + 4}`);
    expect(scroll).toHaveBeenCalledWith(
      expect.objectContaining({ index: PAGE_SIZE + 4, viewPosition: 0.2 })
    );
    expect(peekPlace()).toBeNull();
    scroll.mockRestore();
  });

  it("a product that dropped out of the pages leaves the list at the same position", async () => {
    const scroll = jest.spyOn(FlatList.prototype, "scrollToIndex").mockImplementation(() => {});
    rememberPlace({
      productId: "gone",
      index: 7,
      loadedPages: 0,
      filters: {
        search: "",
        categoryId: null,
        subCategoryId: null,
        lowStockOnly: false,
        status: "active",
      },
    });
    mockFetchProducts.mockResolvedValue(page(0));
    await render();
    await waitForScroll();
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ index: 7 }));
    scroll.mockRestore();
  });

  it("a failed reload falls back to the normal first page", async () => {
    rememberPlace({
      productId: "p-1",
      index: 1,
      loadedPages: 2,
      filters: {
        search: "",
        categoryId: null,
        subCategoryId: null,
        lowStockOnly: false,
        status: "active",
      },
    });
    mockFetchProducts.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(page(0, 2));
    await render();
    expect(names()).toHaveLength(2);
  });

  it("when the screen stayed mounted, only the edited row is refreshed in place", async () => {
    mockFetchProducts.mockResolvedValue(page(0, 5));
    await render();
    await act(async () => {
      rows()[2].props.onPress();
    });
    mockFetchProduct.mockResolvedValue(product(2, "Renamed"));
    const callsBefore = mockFetchProducts.mock.calls.length;
    await act(async () => {
      focusCallbacks.at(-1)?.();
    });
    expect(mockFetchProduct).toHaveBeenCalledWith("p-2", true);
    expect(mockFetchProducts.mock.calls.length).toBe(callsBefore);
    expect(names()[2]).toBe("Renamed");
    expect(rows()[2].props.highlighted).toBe(true);
    expect(peekPlace()).toBeNull();
  });

  it("when the screen stayed mounted, a deleted product disappears from the list", async () => {
    mockFetchProducts.mockResolvedValue(page(0, 5));
    await render();
    await act(async () => {
      rows()[1].props.onPress();
    });
    mockFetchProduct.mockResolvedValue(null);
    await act(async () => {
      focusCallbacks.at(-1)?.();
    });
    expect(names()).toEqual(["Produit 0", "Produit 2", "Produit 3", "Produit 4"]);
  });

  it("a cashier's rows are not tappable, so no place is remembered", async () => {
    mockRole = "cashier";
    mockFetchProducts.mockResolvedValue(page(0, 3));
    await render();
    expect(rows()[0].props.onPress).toBeUndefined();
    expect(peekPlace()).toBeNull();
  });
});
