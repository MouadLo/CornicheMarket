import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import KitEdit from "../../app/(app)/webstore/kit/[id]";
import { confirm, showToast } from "../../src/lib/dialog/store";
import {
  createKit,
  deleteKit,
  fetchKits,
  saveKitItems,
  updateKit,
} from "../../src/lib/webstore/kitQueries";
import { fetchWebProducts } from "../../src/lib/webstore/queries";
import type { WebKit, WebKitItem } from "../../src/lib/webstore/types";
import { findPressable, hasText, manyProducts, webProduct } from "./helpers";

jest.setTimeout(15_000);

let mockId = "kit_a";
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
jest.mock("../../src/lib/webstore/kitQueries", () => ({
  fetchKits: jest.fn(),
  createKit: jest.fn(),
  updateKit: jest.fn(),
  deleteKit: jest.fn(),
  saveKitItems: jest.fn(),
}));
jest.mock("../../src/lib/webstore/queries", () => ({ fetchWebProducts: jest.fn() }));

const line = (id: string, qty = 1, sort = 0): WebKitItem => ({ web_product_id: id, qty, sort });
const kit = (over: Partial<WebKit> = {}): WebKit => ({
  id: "kit_a",
  name: "Kit A",
  name_fr: "Kit A fr",
  published: true,
  sort: 0,
  items: [line("p001", 1, 0), line("p002", 2, 10)],
  ...over,
});
const products = [
  webProduct({ id: "p001", name_fr: "Coca", price_cents: 500 }),
  webProduct({ id: "p002", name_fr: "Fanta", price_cents: 400 }),
  webProduct({ id: "p003", name_fr: "Red Bull", price_cents: 900, published: false }),
];

let tree: ReactTestRenderer;
const render = async (kits: WebKit[] = [kit()], list = products) => {
  jest.mocked(fetchKits).mockResolvedValue(kits);
  jest.mocked(fetchWebProducts).mockResolvedValue(list);
  await act(async () => {
    tree = create(<KitEdit />);
  });
};
const press = async (label: string) => {
  await act(async () => {
    await findPressable(tree.root, label).props.onPress();
  });
};
const type = (index: number, text: string) =>
  act(() => tree.root.findAllByType(TextInput)[index].props.onChangeText(text));
const isDisabled = (label: string) => !!findPressable(tree.root, label).props.disabled;

beforeEach(() => {
  jest.clearAllMocks();
  mockId = "kit_a";
  mockRole = "owner";
  jest.mocked(saveKitItems).mockResolvedValue();
  jest.mocked(updateKit).mockResolvedValue();
  jest.mocked(createKit).mockResolvedValue();
  jest.mocked(deleteKit).mockResolvedValue();
  jest.mocked(confirm).mockResolvedValue(true);
});
afterEach(() => act(() => tree.unmount()));

it("a cashier is sent back to Vente and nothing is loaded", async () => {
  mockRole = "cashier";
  await render();
  expect(tree.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
  expect(fetchKits).not.toHaveBeenCalled();
});

it("shows the lines, the computed total and the status", async () => {
  await render();
  expect(hasText(tree.root, "Coca")).toBe(true);
  expect(hasText(tree.root, "Fanta")).toBe(true);
  // 1 x 5.00 + 2 x 4.00
  expect(hasText(tree.root, "13.00")).toBe(true);
  expect(hasText(tree.root, "webstore.kits.shown")).toBe(true);
});

it("a missing product is shown by its id and can only be removed", async () => {
  await render([kit({ items: [line("p001"), line("p020", 1, 10)] })]);
  expect(hasText(tree.root, 'webstore.kits.missingProduct{"id":"p020"}')).toBe(true);
  expect(hasText(tree.root, "problem.missing")).toBe(true);
  expect(() => findPressable(tree.root, 'webstore.kits.qtyMore{"name":"p020"}')).toThrow();
  await press('webstore.kits.remove{"name":"webstore.kits.missingProduct{\\"id\\":\\"p020\\"}"}');
  expect(hasText(tree.root, "p020")).toBe(false);
});

it("shows a hidden product with its badge and the reason the kit is hidden", async () => {
  await render([kit({ items: [line("p003")] })]);
  expect(hasText(tree.root, "webstore.kits.badge.hidden")).toBe(true);
  expect(hasText(tree.root, "webstore.kits.hiddenBecause")).toBe(true);
});

describe("quantity", () => {
  it("stays within 1 and 10", async () => {
    await render([kit({ items: [line("p001", 1)] })]);
    const more = 'webstore.kits.qtyMore{"name":"Coca"}';
    const less = 'webstore.kits.qtyLess{"name":"Coca"}';
    expect(isDisabled(less)).toBe(true);
    for (let i = 0; i < 9; i++) await press(more);
    expect(isDisabled(more)).toBe(true);
    expect(isDisabled(less)).toBe(false);
    expect(hasText(tree.root, "10.00 DH")).toBe(false);
    expect(hasText(tree.root, "50.00")).toBe(true);
    await press(less);
    expect(isDisabled(more)).toBe(false);
  });
});

describe("order", () => {
  it("moves a line down and saves in that order with sort set by the query", async () => {
    await render();
    await press('webstore.kits.moveDown{"name":"Coca"}');
    await press("webstore.kits.save");
    expect(saveKitItems).toHaveBeenCalledWith(
      "kit_a",
      [
        { web_product_id: "p002", qty: 2 },
        { web_product_id: "p001", qty: 1 },
      ],
      [
        { web_product_id: "p001", qty: 1 },
        { web_product_id: "p002", qty: 2 },
      ]
    );
    expect(mockLeave).toHaveBeenCalled();
  });

  it("the first line cannot move up, the last cannot move down", async () => {
    await render();
    expect(isDisabled('webstore.kits.moveUp{"name":"Coca"}')).toBe(true);
    expect(isDisabled('webstore.kits.moveDown{"name":"Fanta"}')).toBe(true);
  });
});

describe("adding and removing", () => {
  it("adds a product (not those already in the kit), hidden ones with a badge", async () => {
    await render();
    await press("webstore.kits.addItem");
    // Coca and Fanta are already in; Red Bull is offered, hidden
    expect(() => findPressable(tree.root, 'webstore.kits.pick{"name":"Coca"}')).toThrow();
    expect(hasText(tree.root, "Red Bull")).toBe(true);
    await press('webstore.kits.pick{"name":"Red Bull"}');
    await press("webstore.kits.save");
    expect(saveKitItems).toHaveBeenCalledWith(
      "kit_a",
      [
        { web_product_id: "p001", qty: 1 },
        { web_product_id: "p002", qty: 2 },
        { web_product_id: "p003", qty: 1 },
      ],
      expect.any(Array)
    );
  });

  it("removes a line", async () => {
    await render();
    await press('webstore.kits.remove{"name":"Coca"}');
    await press("webstore.kits.save");
    expect(saveKitItems).toHaveBeenCalledWith(
      "kit_a",
      [{ web_product_id: "p002", qty: 2 }],
      expect.any(Array)
    );
  });

  it("does not touch the lines when only the name changed", async () => {
    await render();
    type(0, "Renamed");
    await press("webstore.kits.save");
    expect(updateKit).toHaveBeenCalledWith("kit_a", {
      name: "Renamed",
      name_fr: "Kit A fr",
      published: true,
    });
    expect(saveKitItems).not.toHaveBeenCalled();
  });

  it("stops at 12 lines: add is disabled with a hint", async () => {
    const twelve = manyProducts(13);
    await render(
      [kit({ items: twelve.slice(0, 12).map((p, i) => line(p.id, 1, i * 10)) })],
      twelve
    );
    expect(isDisabled("webstore.kits.addItem")).toBe(true);
    expect(hasText(tree.root, 'webstore.kits.itemsFull{"max":12}')).toBe(true);
  });
});

describe("validation", () => {
  it("an empty name is refused inline and nothing is saved", async () => {
    await render();
    type(0, "   ");
    await press("webstore.kits.save");
    expect(hasText(tree.root, "webstore.kits.errNameRequired")).toBe(true);
    expect(updateKit).not.toHaveBeenCalled();
    expect(saveKitItems).not.toHaveBeenCalled();
  });

  it("a name over 60 characters is refused", async () => {
    await render();
    type(0, "x".repeat(61));
    await press("webstore.kits.save");
    expect(hasText(tree.root, "webstore.kits.errNameTooLong")).toBe(true);
    expect(updateKit).not.toHaveBeenCalled();
  });
});

describe("new kit", () => {
  beforeEach(() => {
    mockId = "new";
  });

  it("creates the kit with a generated id, then its lines in order", async () => {
    await render([kit({ id: "kit_pack" })]);
    expect(() => findPressable(tree.root, "webstore.kits.deleteButton")).toThrow();
    type(0, "Pack Goûter");
    await press("webstore.kits.addItem");
    await press('webstore.kits.pick{"name":"Fanta"}');
    await press("webstore.kits.addItem");
    await press('webstore.kits.pick{"name":"Coca"}');
    await press("webstore.kits.save");
    expect(createKit).toHaveBeenCalledWith({
      id: "kit_pack_gouter",
      name: "Pack Goûter",
      name_fr: null,
      published: true,
    });
    expect(saveKitItems).toHaveBeenCalledWith("kit_pack_gouter", [
      { web_product_id: "p002", qty: 1 },
      { web_product_id: "p001", qty: 1 },
    ]);
    expect(mockLeave).toHaveBeenCalled();
  });

  it("does not leave an empty kit behind when the lines fail to save", async () => {
    jest.mocked(saveKitItems).mockRejectedValue(new Error("boom"));
    await render([]);
    type(0, "Pack");
    await press("webstore.kits.save");
    expect(createKit).toHaveBeenCalled();
    expect(deleteKit).toHaveBeenCalledWith("kit_pack");
    expect(mockLeave).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("asks first and deletes only after a yes", async () => {
    jest.mocked(confirm).mockResolvedValue(false);
    await render();
    await press("webstore.kits.deleteButton");
    expect(confirm).toHaveBeenCalled();
    expect(deleteKit).not.toHaveBeenCalled();

    jest.mocked(confirm).mockResolvedValue(true);
    await press("webstore.kits.deleteButton");
    expect(deleteKit).toHaveBeenCalledWith("kit_a");
    expect(mockLeave).toHaveBeenCalled();
  });

  it("tells the owner when deleting fails", async () => {
    jest.mocked(deleteKit).mockRejectedValue(new Error("boom"));
    await render();
    await press("webstore.kits.deleteButton");
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "webstore.kits.deleteError" })
    );
    expect(mockLeave).not.toHaveBeenCalled();
  });
});
