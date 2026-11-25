import React from "react";
import { Switch } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { KitsTab } from "../../src/components/webstore/KitsTab";
import { showToast } from "../../src/lib/dialog/store";
import { fetchKits, setKitPublished } from "../../src/lib/webstore/kitQueries";
import { fetchWebProducts } from "../../src/lib/webstore/queries";
import type { WebKit, WebKitItem } from "../../src/lib/webstore/types";
import { findPressable, hasText, textOf, webProduct } from "./helpers";

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
jest.mock("../../src/lib/webstore/kitQueries", () => ({
  fetchKits: jest.fn(),
  setKitPublished: jest.fn(),
}));
jest.mock("../../src/lib/webstore/queries", () => ({ fetchWebProducts: jest.fn() }));

const line = (id: string, qty = 1, sort = 0): WebKitItem => ({ web_product_id: id, qty, sort });
const kit = (over: Partial<WebKit> = {}): WebKit => ({
  id: "kit_a",
  name: "Kit A",
  name_fr: null,
  published: true,
  sort: 0,
  items: [line("p001")],
  ...over,
});

const products = [
  webProduct({ id: "p001", name_fr: "Coca", price_cents: 500 }),
  webProduct({ id: "p002", name_fr: "Kinder Bueno", price_cents: 300, manual_in_stock: false }),
  webProduct({ id: "p003", name_fr: "Red Bull", price_cents: 900, published: false }),
  webProduct({ id: "p004", name_fr: "Tonik", price_cents: null }),
];

let tree: ReactTestRenderer;
const render = async (kits: WebKit[]) => {
  jest.mocked(fetchKits).mockResolvedValue(kits);
  jest.mocked(fetchWebProducts).mockResolvedValue(products);
  await act(async () => {
    tree = create(<KitsTab />);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(setKitPublished).mockResolvedValue();
});
afterEach(() => act(() => tree.unmount()));

it("shows the computed price and 'visible' for a kit the page shows", async () => {
  await render([kit({ items: [line("p001", 2, 0)] })]);
  expect(hasText(tree.root, "webstore.kits.shown")).toBe(true);
  expect(hasText(tree.root, "10.00")).toBe(true);
  expect(hasText(tree.root, 'webstore.kits.itemCount{"count":1}')).toBe(true);
});

it("says why a kit is hidden: missing id, sold out, hidden product, no price", async () => {
  await render([
    kit({ id: "k1", sort: 0, name: "K missing", items: [line("p020")] }),
    kit({ id: "k2", sort: 1, name: "K sold out", items: [line("p002")] }),
    kit({ id: "k3", sort: 2, name: "K hidden", items: [line("p003")] }),
    kit({ id: "k4", sort: 3, name: "K no price", items: [line("p001", 1, 0), line("p004", 1, 1)] }),
  ]);
  const text = textOf(tree.root);
  expect(text).toContain("webstore.kits.hiddenBecause");
  expect(text).toContain("problem.missing");
  expect(text).toContain("p020");
  expect(text).toContain("problem.soldOut");
  expect(text).toContain("Kinder Bueno");
  expect(text).toContain("problem.hidden");
  expect(text).toContain("Red Bull");
  expect(text).toContain("problem.noPrice");
  expect(text).toContain("Tonik");
  // the kit with a line without a price has an incomplete price
  expect(text).toContain("webstore.kits.priceIncomplete");
  expect(text).not.toContain("webstore.kits.shown");
});

it("warns when more than 20 kits are published", async () => {
  const many = Array.from({ length: 21 }, (_, i) =>
    kit({ id: `kit_${String(i).padStart(2, "0")}`, sort: i, name: `Kit ${i}` })
  );
  await render(many);
  expect(hasText(tree.root, 'webstore.kits.warnLimit{"max":20,"count":21}')).toBe(true);
});

it("no warning at 20", async () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    kit({ id: `kit_${String(i).padStart(2, "0")}`, sort: i, name: `Kit ${i}` })
  );
  await render(many);
  expect(hasText(tree.root, "webstore.kits.warnLimit")).toBe(false);
});

it("the publish switch saves at once", async () => {
  await render([kit()]);
  await act(async () => {
    tree.root.findByType(Switch).props.onValueChange(false);
  });
  expect(setKitPublished).toHaveBeenCalledWith("kit_a", false);
  expect(tree.root.findByType(Switch).props.value).toBe(false);
  // an unpublished kit says so
  expect(hasText(tree.root, "problem.unpublished")).toBe(true);
});

it("reverts the switch and tells the owner when saving fails", async () => {
  jest.mocked(setKitPublished).mockRejectedValue(new Error("boom"));
  await render([kit()]);
  await act(async () => {
    tree.root.findByType(Switch).props.onValueChange(false);
  });
  expect(tree.root.findByType(Switch).props.value).toBe(true);
  expect(showToast).toHaveBeenCalledWith(
    expect.objectContaining({ text: "webstore.kits.publishError" })
  );
});

it("opens a kit and the new-kit screen", async () => {
  await render([kit()]);
  act(() => findPressable(tree.root, "Kit A").props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/(app)/webstore/kit/kit_a");
  act(() => findPressable(tree.root, "webstore.kits.add").props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/(app)/webstore/kit/new");
});
