import React from "react";
import { Switch } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import WebstoreList from "../../app/(app)/webstore/index";
import { confirm, showToast } from "../../src/lib/dialog/store";
import { fetchWebProducts, setPublished } from "../../src/lib/webstore/queries";
import type { WebProduct } from "../../src/lib/webstore/types";
import { findPressable, hasText, linkedProduct, manyProducts, webProduct } from "./helpers";

jest.setTimeout(15_000);

const mockPush = jest.fn();
let mockRole: "owner" | "cashier" = "owner";
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    router: { push: (...a: unknown[]) => mockPush(...a) },
    Redirect: ({ href }: { href: string }) => React.createElement("Redirect", { href }),
    useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]),
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
jest.mock("../../src/lib/webstore/queries", () => ({
  fetchWebProducts: jest.fn(),
  setPublished: jest.fn(),
}));

let tree: ReactTestRenderer;
const render = async (list: WebProduct[]) => {
  jest.mocked(fetchWebProducts).mockResolvedValue(list);
  await act(async () => {
    tree = create(<WebstoreList />);
  });
};
const switches = () => tree.root.findAllByType(Switch);
const rowCount = () => switches().length;

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  jest.mocked(setPublished).mockResolvedValue();
  jest.mocked(confirm).mockResolvedValue(true);
});
afterEach(() => act(() => tree.unmount()));

it("a cashier is sent back to Vente and nothing is loaded", async () => {
  mockRole = "cashier";
  await render(manyProducts(25));
  expect(tree.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
  expect(fetchWebProducts).not.toHaveBeenCalled();
});

describe("summary and the 20-product warning", () => {
  it("counts the products the site will show and those in stock, no warning at 20", async () => {
    const list = [
      ...manyProducts(19),
      webProduct({ id: "p100", manual_in_stock: false }),
      webProduct({ id: "p101", published: false }),
    ];
    await render(list);
    expect(hasText(tree.root, 'webstore.summary{"count":20,"stock":19}')).toBe(true);
    expect(hasText(tree.root, "webstore.warnBelow")).toBe(false);
  });

  it("warns below 20 (published and in the feed)", async () => {
    await render(manyProducts(19));
    expect(hasText(tree.root, 'webstore.warnBelow{"min":20,"count":19}')).toBe(true);
  });

  it("published products whose app product is inactive do not count and are listed", async () => {
    const list = [
      ...manyProducts(20),
      linkedProduct({ id: "p900", name_fr: "Fantôme" }, { active: false }),
    ];
    await render(list);
    expect(hasText(tree.root, 'webstore.summary{"count":20')).toBe(true);
    expect(hasText(tree.root, "webstore.excludedBanner")).toBe(true);
    expect(hasText(tree.root, "Fantôme")).toBe(true);
  });

  it("no excluded banner when nothing is excluded", async () => {
    await render(manyProducts(20));
    expect(hasText(tree.root, "webstore.excludedBanner")).toBe(false);
  });
});

describe("search and filter chips", () => {
  const list = [
    webProduct({ id: "p001", name_fr: "Coca Cola", published: true }),
    webProduct({ id: "p002", name_fr: "Fanta", published: false, keywords: "orange soda" }),
    linkedProduct(
      { id: "p003", name_fr: "Eau", price_cents: 400 },
      { id: "a3", selling_price_cents: 500 }
    ),
    linkedProduct(
      { id: "p004", name_fr: "Lait", price_cents: 700 },
      { id: "a4", selling_price_cents: 700 }
    ),
    webProduct({ id: "p005", name_fr: "Mystère", price_cents: null }),
  ];

  const names = () =>
    tree.root
      .findAll(
        (n) =>
          typeof n.props.onPress === "function" && typeof n.props.accessibilityLabel === "string"
      )
      .map((n) => n.props.accessibilityLabel as string)
      .filter((label, i, all) => all.indexOf(label) === i);

  it.each([
    ["webstore.filterAll", ["Coca Cola", "Fanta", "Eau", "Lait", "Mystère"]],
    ["webstore.filterPublished", ["Coca Cola", "Eau", "Lait", "Mystère"]],
    ["webstore.filterHidden", ["Fanta"]],
    ["webstore.filterUnlinked", ["Coca Cola", "Fanta", "Mystère"]],
    ["webstore.filterPriceDiff", ["Eau"]],
    ["webstore.filterNoPrice", ["Mystère"]],
  ])("%s", async (chip, expected) => {
    await render(list);
    act(() => findPressable(tree.root, chip).props.onPress());
    expect(names()).toEqual(expected);
  });

  it("search finds by name, id and keyword, ignoring case and accents", async () => {
    await render(list);
    const input = tree.root.findByProps({ accessibilityLabel: "webstore.search" });
    act(() => input.props.onChangeText("MYSTERE"));
    expect(rowCount()).toBe(1);
    act(() => input.props.onChangeText("p002"));
    expect(rowCount()).toBe(1);
    act(() => input.props.onChangeText("orange"));
    expect(rowCount()).toBe(1);
    act(() => input.props.onChangeText("zzz"));
    expect(hasText(tree.root, "webstore.noMatch")).toBe(true);
  });
});

describe("rows", () => {
  it("shows the app price when linked, 'à confirmer' without a price, and the link state", async () => {
    await render([
      linkedProduct(
        { id: "p001", name_fr: "Eau", price_cents: 100 },
        { name: "Eau 1L", selling_price_cents: 250 }
      ),
      webProduct({ id: "p002", name_fr: "Sans prix", price_cents: null }),
    ]);
    expect(hasText(tree.root, "2.50")).toBe(true);
    expect(hasText(tree.root, "1.00")).toBe(false);
    expect(hasText(tree.root, "webstore.priceToConfirm")).toBe(true);
    expect(hasText(tree.root, "webstore.linkedTo")).toBe(true);
    expect(hasText(tree.root, "webstore.notLinked")).toBe(true);
  });

  it("marks automatic stock and out of stock", async () => {
    await render([linkedProduct({ stock_mode: "auto" }, { stock_quantity: 0 })]);
    expect(hasText(tree.root, "webstore.outOfStock · webstore.auto")).toBe(true);
  });

  it("opens the edit screen on tap and the creation flow from the button", async () => {
    await render([webProduct({ id: "p007", name_fr: "Coca" })]);
    act(() => findPressable(tree.root, "Coca").props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/webstore/p007");
    act(() => findPressable(tree.root, "webstore.add").props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/webstore/new");
  });
});

describe("the publish switch", () => {
  it("saves at once", async () => {
    await render(manyProducts(25));
    await act(async () => switches()[0].props.onValueChange(false));
    expect(setPublished).toHaveBeenCalledWith("p001", false);
    expect(confirm).not.toHaveBeenCalled();
    expect(switches()[0].props.value).toBe(false);
  });

  it("asks first when hiding would drop the site below 20, and does nothing on no", async () => {
    jest.mocked(confirm).mockResolvedValue(false);
    await render(manyProducts(20));
    await act(async () => switches()[0].props.onValueChange(false));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "webstore.hideTitle", tone: "danger" })
    );
    expect(setPublished).not.toHaveBeenCalled();
    expect(switches()[0].props.value).toBe(true);
  });

  it("hides after a yes", async () => {
    await render(manyProducts(20));
    await act(async () => switches()[0].props.onValueChange(false));
    expect(setPublished).toHaveBeenCalledWith("p001", false);
    expect(switches()[0].props.value).toBe(false);
  });

  it("publishing never asks", async () => {
    await render([...manyProducts(5), webProduct({ id: "p900", published: false })]);
    await act(async () => switches()[5].props.onValueChange(true));
    expect(confirm).not.toHaveBeenCalled();
    expect(setPublished).toHaveBeenCalledWith("p900", true);
  });

  it("on a failed save the switch goes back and a toast says so", async () => {
    jest.mocked(setPublished).mockRejectedValue(new Error("boom"));
    await render(manyProducts(25));
    await act(async () => switches()[0].props.onValueChange(false));
    expect(switches()[0].props.value).toBe(true);
    expect(showToast).toHaveBeenCalledWith({ text: "webstore.publishError", tone: "info" });
  });
});

it("a load error shows the retry screen, not an empty list", async () => {
  jest.mocked(fetchWebProducts).mockRejectedValue(new Error("Failed to fetch"));
  await act(async () => {
    tree = create(<WebstoreList />);
  });
  expect(hasText(tree.root, "webstore.loadError")).toBe(true);
});
