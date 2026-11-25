import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import CategoryEdit from "../../app/(app)/webstore/category/[id]";
import { confirm } from "../../src/lib/dialog/store";
import {
  createCategory,
  createSub,
  deleteCategory,
  deleteSub,
  fetchUsageCounts,
  InUseError,
  moveSub,
  updateCategory,
  updateSub,
} from "../../src/lib/webstore/categoryQueries";
import { fetchWebCategories } from "../../src/lib/webstore/queries";
import type { UsageCounts } from "../../src/lib/webstore/categories";
import type { WebCategory } from "../../src/lib/webstore/types";
import { findPressable, hasText } from "./helpers";

jest.setTimeout(15_000);

let mockId = "drinks";
let mockRole: "owner" | "cashier" = "owner";
const mockLeave = jest.fn();
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useLocalSearchParams: () => ({ id: mockId }),
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
jest.mock("../../src/lib/dialog/store", () => ({ showToast: jest.fn(), confirm: jest.fn() }));
jest.mock("../../src/lib/nav/useLeaveScreen", () => ({ useLeaveScreen: () => mockLeave }));
jest.mock("../../src/lib/products/useUnsavedGuard", () => ({ useUnsavedGuard: () => jest.fn() }));
jest.mock("../../src/lib/webstore/categoryQueries", () => {
  class InUseError extends Error {
    count: number;
    constructor(count: number) {
      super("in use");
      this.count = count;
    }
  }
  return {
    InUseError,
    fetchUsageCounts: jest.fn(),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    deleteCategory: jest.fn(),
    createSub: jest.fn(),
    updateSub: jest.fn(),
    moveSub: jest.fn(),
    deleteSub: jest.fn(),
  };
});
jest.mock("../../src/lib/webstore/queries", () => ({ fetchWebCategories: jest.fn() }));

const cats: WebCategory[] = [
  {
    id: "drinks",
    name: "Drinks",
    name_fr: "Boissons",
    icon: "drinks",
    sort: 0,
    subs: [
      { code: "soda", name: "Soda", name_fr: "Sodas", sort: 0 },
      { code: "water", name: "Water", name_fr: "Eau", sort: 1 },
    ],
  },
  { id: "snacks", name: "Snacks", name_fr: "Snacks", icon: "snacks", sort: 1, subs: [] },
];
const noUsage: UsageCounts = { byCategory: {}, bySub: {} };

let tree: ReactTestRenderer;
const render = async (usage: UsageCounts = noUsage) => {
  jest.mocked(fetchWebCategories).mockResolvedValue(cats);
  jest.mocked(fetchUsageCounts).mockResolvedValue(usage);
  await act(async () => {
    tree = create(<CategoryEdit />);
  });
};
const press = async (label: string) => {
  await act(async () => {
    await findPressable(tree.root, label).props.onPress();
  });
};
const inputs = () => tree.root.findAllByType(TextInput);
const type = (index: number, text: string) => act(() => inputs()[index].props.onChangeText(text));

beforeEach(() => {
  jest.clearAllMocks();
  mockId = "drinks";
  mockRole = "owner";
  for (const fn of [
    createCategory,
    updateCategory,
    deleteCategory,
    createSub,
    updateSub,
    moveSub,
    deleteSub,
  ]) {
    jest.mocked(fn as jest.Mock).mockResolvedValue(undefined);
  }
  jest.mocked(confirm).mockResolvedValue(true);
});
afterEach(() => act(() => tree.unmount()));

it("a cashier is sent back to Vente", async () => {
  mockRole = "cashier";
  await render();
  expect(tree.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
  expect(fetchWebCategories).not.toHaveBeenCalled();
});

describe("the category", () => {
  it("saves the chosen icon and the names", async () => {
    await render();
    await press("webstore.cats.icon.gift");
    await press("webstore.cats.save");
    expect(updateCategory).toHaveBeenCalledWith("drinks", {
      name: "Drinks",
      name_fr: "Boissons",
      icon: "gift",
    });
    expect(mockLeave).toHaveBeenCalled();
  });

  it("refuses an empty name", async () => {
    await render();
    type(0, " ");
    await press("webstore.cats.save");
    expect(hasText(tree.root, "webstore.cats.errNameRequired")).toBe(true);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("an unknown stored icon is shown and saved as bag", async () => {
    jest.mocked(fetchWebCategories).mockResolvedValue([{ ...cats[0], icon: "rocket" }, cats[1]]);
    jest.mocked(fetchUsageCounts).mockResolvedValue(noUsage);
    await act(async () => {
      tree = create(<CategoryEdit />);
    });
    await press("webstore.cats.save");
    expect(updateCategory).toHaveBeenCalledWith("drinks", expect.objectContaining({ icon: "bag" }));
  });

  it("creates a new category with a generated id", async () => {
    mockId = "new";
    await render();
    type(0, "Épicerie");
    type(1, "Épicerie fr");
    await press("webstore.cats.icon.cup");
    await press("webstore.cats.save");
    expect(createCategory).toHaveBeenCalledWith({
      id: "epicerie",
      name: "Épicerie",
      name_fr: "Épicerie fr",
      icon: "cup",
    });
    expect(mockLeave).toHaveBeenCalled();
    // no sub-category section and no delete before the category exists
    expect(hasText(tree.root, "webstore.cats.subsAfterSave")).toBe(true);
  });

  it("refuses to delete a category that products use, saying how many", async () => {
    await render({ byCategory: { drinks: 3 }, bySub: {} });
    await press("webstore.cats.deleteButton");
    expect(hasText(tree.root, 'webstore.cats.inUse{"count":3}')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it("falls back to the refusal of the query when the counts were stale", async () => {
    jest.mocked(deleteCategory).mockRejectedValue(new InUseError(5));
    await render();
    await press("webstore.cats.deleteButton");
    expect(confirm).toHaveBeenCalled();
    expect(hasText(tree.root, 'webstore.cats.inUse{"count":5}')).toBe(true);
    expect(mockLeave).not.toHaveBeenCalled();
  });

  it("deletes an unused category after asking", async () => {
    await render();
    await press("webstore.cats.deleteButton");
    expect(deleteCategory).toHaveBeenCalledWith("drinks");
    expect(mockLeave).toHaveBeenCalled();
  });

  it("does not delete when the owner says no", async () => {
    jest.mocked(confirm).mockResolvedValue(false);
    await render();
    await press("webstore.cats.deleteButton");
    expect(deleteCategory).not.toHaveBeenCalled();
  });
});

describe("sub-categories", () => {
  it("lists them with the number of products", async () => {
    await render({ byCategory: {}, bySub: { "drinks/soda": 4 } });
    expect(hasText(tree.root, "Sodas")).toBe(true);
    expect(hasText(tree.root, 'webstore.cats.productsCount{"count":4}')).toBe(true);
  });

  it("adds one: the code is the English name", async () => {
    await render();
    // inputs: category EN, FR, then (subs card) add EN, add FR
    type(2, "Juice");
    type(3, "Jus");
    await press("webstore.cats.subAdd");
    expect(createSub).toHaveBeenCalledWith("drinks", {
      code: "Juice",
      name: "Juice",
      name_fr: "Jus",
    });
    expect(fetchWebCategories).toHaveBeenCalledTimes(2);
  });

  it("makes the code unique inside the category", async () => {
    await render();
    type(2, "soda");
    type(3, "Soda fr");
    await press("webstore.cats.subAdd");
    expect(createSub).toHaveBeenCalledWith("drinks", expect.objectContaining({ code: "soda 2" }));
  });

  it("asks for both names", async () => {
    await render();
    type(2, "Juice");
    await press("webstore.cats.subAdd");
    expect(createSub).not.toHaveBeenCalled();
    expect(hasText(tree.root, "webstore.cats.errNameRequired")).toBe(true);
  });

  it("renames one without changing its code", async () => {
    await render();
    await press('webstore.cats.subRename{"name":"Sodas"}');
    // inputs now: category EN, FR, rename EN, FR (first sub), ...
    type(2, "Sodas new");
    await press("webstore.cats.subSave");
    expect(updateSub).toHaveBeenCalledWith("drinks", "soda", {
      name: "Sodas new",
      name_fr: "Sodas",
    });
  });

  it("moves one down", async () => {
    await render();
    await press('webstore.cats.subMoveDown{"name":"Sodas"}');
    expect(moveSub).toHaveBeenCalledWith(
      "drinks",
      [
        { code: "soda", sort: 0 },
        { code: "water", sort: 1 },
      ],
      "soda",
      1
    );
  });

  it("refuses to delete a sub-category that products use, saying how many", async () => {
    await render({ byCategory: {}, bySub: { "drinks/soda": 2 } });
    await press('webstore.cats.subDelete{"name":"Sodas"}');
    expect(hasText(tree.root, 'webstore.cats.subInUse{"count":2}')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(deleteSub).not.toHaveBeenCalled();
  });

  it("deletes an unused one after asking, for its own category", async () => {
    await render();
    await press('webstore.cats.subDelete{"name":"Eau"}');
    expect(confirm).toHaveBeenCalled();
    expect(deleteSub).toHaveBeenCalledWith("drinks", "water");
  });

  it("shows the refusal when the database says it is used", async () => {
    jest.mocked(deleteSub).mockRejectedValue(new InUseError(0));
    await render();
    await press('webstore.cats.subDelete{"name":"Eau"}');
    expect(hasText(tree.root, "webstore.cats.subInUseSome")).toBe(true);
  });
});
