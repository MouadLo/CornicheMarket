import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { CategoriesTab } from "../../src/components/webstore/CategoriesTab";
import { showToast } from "../../src/lib/dialog/store";
import { fetchUsageCounts, moveCategory } from "../../src/lib/webstore/categoryQueries";
import { fetchWebCategories } from "../../src/lib/webstore/queries";
import { categories, findPressable, hasText } from "./helpers";

jest.setTimeout(15_000);

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    router: { push: (...a: unknown[]) => mockPush(...a) },
    useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]),
  };
});
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/dialog/store", () => ({ showToast: jest.fn(), confirm: jest.fn() }));
jest.mock("../../src/lib/webstore/categoryQueries", () => ({
  fetchUsageCounts: jest.fn(),
  moveCategory: jest.fn(),
}));
jest.mock("../../src/lib/webstore/queries", () => ({ fetchWebCategories: jest.fn() }));

let tree: ReactTestRenderer;
const render = async () => {
  jest.mocked(fetchWebCategories).mockResolvedValue(categories);
  jest.mocked(fetchUsageCounts).mockResolvedValue({
    byCategory: { drinks: 12, snacks: 3 },
    bySub: { "drinks/soda": 4 },
  });
  await act(async () => {
    tree = create(<CategoriesTab />);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(moveCategory).mockResolvedValue();
});
afterEach(() => act(() => tree.unmount()));

it("lists the categories with their sub-category and product counts", async () => {
  await render();
  expect(hasText(tree.root, "Boissons")).toBe(true);
  expect(hasText(tree.root, 'webstore.cats.counts{"subs":1,"products":12}')).toBe(true);
  expect(hasText(tree.root, 'webstore.cats.counts{"subs":0,"products":3}')).toBe(true);
});

it("opens a category and the new-category screen", async () => {
  await render();
  act(() => findPressable(tree.root, "Boissons").props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/(app)/webstore/category/drinks");
  act(() => findPressable(tree.root, "webstore.cats.add").props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/(app)/webstore/category/new");
});

it("the arrows reorder through moveCategory and reload the list", async () => {
  await render();
  await act(async () => {
    await findPressable(tree.root, 'webstore.cats.moveDown{"name":"Boissons"}').props.onPress();
  });
  expect(moveCategory).toHaveBeenCalledWith(categories, "drinks", 1);
  expect(fetchWebCategories).toHaveBeenCalledTimes(2);
});

it("the first cannot move up and the last cannot move down", async () => {
  await render();
  expect(findPressable(tree.root, 'webstore.cats.moveUp{"name":"Boissons"}').props.disabled).toBe(
    true
  );
  expect(findPressable(tree.root, 'webstore.cats.moveDown{"name":"Snacks"}').props.disabled).toBe(
    true
  );
});

it("tells the owner when the order could not be saved", async () => {
  jest.mocked(moveCategory).mockRejectedValue(new Error("boom"));
  await render();
  await act(async () => {
    await findPressable(tree.root, 'webstore.cats.moveDown{"name":"Boissons"}').props.onPress();
  });
  expect(showToast).toHaveBeenCalledWith(
    expect.objectContaining({ text: "webstore.cats.moveError" })
  );
});
