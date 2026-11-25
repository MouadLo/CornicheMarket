import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import EditScreen from "../../app/(app)/webstore/[id]";
import { confirm, showToast } from "../../src/lib/dialog/store";
import { removeWebImageFile, setImageSource } from "../../src/lib/webstore/imageQueries";
import { updateSellingPrice } from "../../src/lib/products/queries";
import {
  deleteWebProduct,
  fetchKitsUsing,
  fetchLinkCandidates,
  fetchWebCategories,
  fetchWebProducts,
  linkWebProduct,
  setPublished,
  updateWebProduct,
} from "../../src/lib/webstore/queries";
import type { WebProduct } from "../../src/lib/webstore/types";
import {
  appProduct,
  categories,
  findPressable,
  hasText,
  linkedProduct,
  manyProducts,
  webProduct,
} from "./helpers";

jest.setTimeout(15_000);

let mockRole: "owner" | "cashier" = "owner";
const mockLeave = jest.fn();
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useLocalSearchParams: () => ({ id: "p001" }),
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
jest.mock("../../src/lib/products/queries", () => ({ updateSellingPrice: jest.fn() }));
jest.mock("../../src/components/stock/ProductSearchPicker", () => {
  const React = require("react");
  return { ProductSearchPicker: (p: object) => React.createElement("Picker", p) };
});
jest.mock("../../src/lib/products/photoPicker", () => ({ pickProductPhoto: jest.fn() }));
jest.mock("../../src/lib/products/photoUrls", () => ({ usePhotoUrl: () => null }));
jest.mock("../../src/lib/webstore/imageQueries", () => ({
  uploadWebImage: jest.fn(),
  copyAppPhotoToWeb: jest.fn(),
  setImageSource: jest.fn(),
  removeWebImageFile: jest.fn(),
}));
jest.mock("../../src/lib/webstore/queries", () => ({
  fetchWebProducts: jest.fn(),
  fetchWebCategories: jest.fn(),
  fetchLinkCandidates: jest.fn(),
  fetchKitsUsing: jest.fn(),
  updateWebProduct: jest.fn(),
  setPublished: jest.fn(),
  linkWebProduct: jest.fn(),
  deleteWebProduct: jest.fn(),
}));

let tree: ReactTestRenderer;
const render = async (list: WebProduct[], candidates = [appProduct()]) => {
  jest.mocked(fetchWebProducts).mockResolvedValue(list);
  jest.mocked(fetchLinkCandidates).mockResolvedValue(candidates);
  await act(async () => {
    tree = create(<EditScreen />);
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
  jest.mocked(fetchKitsUsing).mockResolvedValue([]);
  jest.mocked(confirm).mockResolvedValue(true);
  jest.mocked(updateWebProduct).mockResolvedValue();
  jest.mocked(linkWebProduct).mockResolvedValue();
  jest.mocked(updateSellingPrice).mockResolvedValue();
  jest.mocked(deleteWebProduct).mockResolvedValue();
  jest.mocked(setPublished).mockResolvedValue();
});
afterEach(() => act(() => tree.unmount()));

it("a cashier is sent back to Vente and nothing is loaded", async () => {
  mockRole = "cashier";
  await render([webProduct()]);
  expect(tree.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
  expect(fetchWebProducts).not.toHaveBeenCalled();
});

describe("linking", () => {
  const unlinked = () =>
    webProduct({ id: "p001", name_fr: "Coca Cola", size: "33cl", price_cents: null });

  it("proposes the likely app product with its confidence", async () => {
    await render([unlinked()]);
    expect(hasText(tree.root, "Coca Cola 33cl")).toBe(true);
    expect(hasText(tree.root, "webstore.confProposed")).toBe(true);
  });

  it("links straight away when the prices do not conflict (no site price)", async () => {
    await render([unlinked()]);
    await press("webstore.linkAction");
    expect(linkWebProduct).toHaveBeenCalledWith("p001", "a1");
    expect(updateSellingPrice).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ testID: "webstore-conflict" })).toHaveLength(0);
  });

  it("links straight away when the prices are equal", async () => {
    await render([webProduct({ price_cents: 600 })]);
    await press("webstore.linkAction");
    expect(linkWebProduct).toHaveBeenCalledWith("p001", "a1");
  });

  describe("with different prices (site 5.50, app 6.00)", () => {
    const conflicting = () => webProduct({ price_cents: 550, name_fr: "Coca Cola", size: "33cl" });

    it("shows three choices and links nothing yet", async () => {
      await render([conflicting()]);
      await press("webstore.linkAction");
      expect(linkWebProduct).not.toHaveBeenCalled();
      expect(tree.root.findAllByProps({ testID: "webstore-conflict" }).length).toBeGreaterThan(0);
      expect(hasText(tree.root, "webstore.keepAppPrice")).toBe(true);
      expect(hasText(tree.root, "webstore.siteIsRight")).toBe(true);
      expect(hasText(tree.root, "5.50")).toBe(true);
    });

    it("'keep the app price' only links", async () => {
      await render([conflicting()]);
      await press("webstore.linkAction");
      await press("webstore.keepAppPrice");
      expect(linkWebProduct).toHaveBeenCalledWith("p001", "a1");
      expect(updateSellingPrice).not.toHaveBeenCalled();
    });

    it("'the site price is right' changes the app price through the product price path, then links", async () => {
      const order: string[] = [];
      jest.mocked(updateSellingPrice).mockImplementation(async () => void order.push("price"));
      jest.mocked(linkWebProduct).mockImplementation(async () => void order.push("link"));
      await render([conflicting()]);
      await press("webstore.linkAction");
      await press("webstore.siteIsRight");
      expect(updateSellingPrice).toHaveBeenCalledWith("a1", 550);
      expect(linkWebProduct).toHaveBeenCalledWith("p001", "a1");
      expect(order).toEqual(["price", "link"]);
    });

    it("if the price change fails nothing is linked", async () => {
      jest.mocked(updateSellingPrice).mockRejectedValue(new Error("boom"));
      await render([conflicting()]);
      await press("webstore.linkAction");
      await press("webstore.siteIsRight");
      expect(linkWebProduct).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith({ text: "webstore.priceChangeError", tone: "info" });
    });

    it("if the link fails after the price changed, the owner is told", async () => {
      jest.mocked(linkWebProduct).mockRejectedValue(new Error("boom"));
      await render([conflicting()]);
      await press("webstore.linkAction");
      await press("webstore.siteIsRight");
      expect(showToast).toHaveBeenCalledWith({
        text: "webstore.priceChangedLinkFailed",
        tone: "info",
      });
    });

    it("cancel closes the choice and changes nothing", async () => {
      await render([conflicting()]);
      await press("webstore.linkAction");
      await press("common.cancel");
      expect(tree.root.findAllByProps({ testID: "webstore-conflict" })).toHaveLength(0);
      expect(linkWebProduct).not.toHaveBeenCalled();
      expect(updateSellingPrice).not.toHaveBeenCalled();
    });
  });

  it("a product picked in the search goes through the same price check", async () => {
    await render([webProduct({ price_cents: 100 })]);
    const picker = tree.root.findByType("Picker" as never);
    await act(async () =>
      picker.props.onPick({ ...appProduct({ id: "a9", name: "Autre" }), barcode: null })
    );
    expect(linkWebProduct).not.toHaveBeenCalled();
    expect(hasText(tree.root, "webstore.conflictTitle")).toBe(true);
  });

  it("unlinking sets the link to null and reloads", async () => {
    await render([linkedProduct({ id: "p001" })]);
    jest.mocked(fetchWebProducts).mockClear();
    await press("webstore.linkRemove");
    expect(linkWebProduct).toHaveBeenCalledWith("p001", null);
    expect(fetchWebProducts).toHaveBeenCalledTimes(1);
  });

  it("when linked it shows the app product, price and stock, and hides suggestions", async () => {
    await render([linkedProduct({}, { selling_price_cents: 725, stock_quantity: 12 })]);
    expect(hasText(tree.root, "webstore.linkedAppPrice")).toBe(true);
    expect(hasText(tree.root, '"qty":12')).toBe(true);
    expect(hasText(tree.root, "webstore.suggestions")).toBe(false);
  });
});

describe("price section", () => {
  it("linked: read-only app price, the typed price kept greyed as the old price", async () => {
    await render([linkedProduct({ price_cents: 400 }, { selling_price_cents: 725 })]);
    expect(hasText(tree.root, "7.25")).toBe(true);
    expect(hasText(tree.root, "webstore.priceOld")).toBe(true);
    expect(tree.root.findAllByProps({ label: "webstore.priceLabel" })).toHaveLength(0);
  });

  it("not linked: a money input, empty means prix à confirmer", async () => {
    await render([webProduct({ price_cents: 550 })]);
    const input = tree.root.findAllByProps({ label: "webstore.priceLabel" })[0];
    expect(input.props.value).toBe("5.50");
    act(() => input.props.onChangeText(""));
    await press("webstore.save");
    expect(updateWebProduct).toHaveBeenCalledWith(
      "p001",
      expect.objectContaining({ price_cents: null })
    );
  });
});

describe("stock section", () => {
  it("automatic is disabled with a hint while not linked", async () => {
    await render([webProduct()]);
    const auto = tree.root
      .findAll(
        (n) =>
          n.props.accessibilityRole === "radio" &&
          typeof n.props.onPress === "function" &&
          hasText(n, "webstore.stockAuto")
      )
      .at(-1)!;
    expect(auto.props.accessibilityState.disabled).toBe(true);
    act(() => auto.props.onPress());
    expect(hasText(tree.root, "webstore.stockSwitch")).toBe(true);
    expect(hasText(tree.root, "webstore.stockAutoNeedsLink")).toBe(true);
  });

  it("automatic is available when linked and shows what the app says", async () => {
    await render([linkedProduct({}, { stock_quantity: 0 })]);
    const auto = tree.root
      .findAll(
        (n) =>
          n.props.accessibilityRole === "radio" &&
          typeof n.props.onPress === "function" &&
          hasText(n, "webstore.stockAuto")
      )
      .at(-1)!;
    expect(auto.props.accessibilityState.disabled).toBe(false);
    act(() => auto.props.onPress());
    expect(hasText(tree.root, "webstore.stockAutoLine")).toBe(true);
    expect(hasText(tree.root, "webstore.outOfStock")).toBe(true);
    await press("webstore.save");
    expect(updateWebProduct).toHaveBeenCalledWith(
      "p001",
      expect.objectContaining({ stock_mode: "auto" })
    );
  });
});

describe("saving", () => {
  it("shows field errors instead of writing", async () => {
    await render([webProduct()]);
    const name = tree.root.findAllByProps({ label: "webstore.fName" })[0];
    act(() => name.props.onChangeText("   "));
    const image = tree.root.findAllByProps({ label: "webstore.fImage" })[0];
    act(() => image.props.onChangeText("http://nope"));
    await press("webstore.save");
    expect(updateWebProduct).not.toHaveBeenCalled();
    expect(hasText(tree.root, "webstore.errNameRequired")).toBe(true);
    expect(hasText(tree.root, "webstore.errImageUrl")).toBe(true);
  });

  it("writes the trimmed fields, then leaves", async () => {
    await render([webProduct()]);
    const name = tree.root.findAllByProps({ label: "webstore.fName" })[0];
    act(() => name.props.onChangeText("  Coca Zero "));
    await press("webstore.save");
    expect(updateWebProduct).toHaveBeenCalledWith(
      "p001",
      expect.objectContaining({ name: "Coca Zero", category_id: "drinks" })
    );
    expect(mockLeave).toHaveBeenCalled();
  });

  it("a failed save stays on the screen", async () => {
    jest.mocked(updateWebProduct).mockRejectedValue(new Error("boom"));
    await render([webProduct()]);
    await press("webstore.save");
    expect(mockLeave).not.toHaveBeenCalled();
    expect(hasText(tree.root, "errors.generic")).toBe(true);
  });
});

describe("publishing from the edit screen", () => {
  it("asks first when hiding would drop the site below 20", async () => {
    jest.mocked(confirm).mockResolvedValue(false);
    await render(manyProducts(20));
    const sw = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "webstore.publishedLabel" && n.props.onValueChange
    )[0];
    await act(async () => sw.props.onValueChange(false));
    expect(confirm).toHaveBeenCalled();
    expect(setPublished).not.toHaveBeenCalled();
  });
});

describe("deleting", () => {
  it("asks first and deletes nothing on cancel", async () => {
    jest.mocked(confirm).mockResolvedValue(false);
    await render([webProduct()]);
    await press("webstore.deleteButton");
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger" }));
    expect(deleteWebProduct).not.toHaveBeenCalled();
  });

  it("deletes the web row after a yes, then leaves", async () => {
    await render([webProduct()]);
    await press("webstore.deleteButton");
    expect(deleteWebProduct).toHaveBeenCalledWith("p001");
    expect(mockLeave).toHaveBeenCalled();
  });

  it("names the kits that use the product in the confirmation", async () => {
    jest.mocked(fetchKitsUsing).mockResolvedValue(["Pack soirée", "Pack été"]);
    await render([webProduct()]);
    await press("webstore.deleteButton");
    expect(fetchKitsUsing).toHaveBeenCalledWith("p001");
    const message = jest.mocked(confirm).mock.calls[0][0].message ?? "";
    expect(message).toContain("webstore.deleteKits");
    expect(message).toContain("Pack soirée, Pack été");
  });

  it("still asks when the kits cannot be read", async () => {
    jest.mocked(fetchKitsUsing).mockRejectedValue(new Error("boom"));
    await render([webProduct()]);
    await press("webstore.deleteButton");
    expect(confirm).toHaveBeenCalled();
  });

  it("a failed delete tells the owner", async () => {
    jest.mocked(deleteWebProduct).mockRejectedValue(new Error("boom"));
    await render([webProduct()]);
    await press("webstore.deleteButton");
    expect(showToast).toHaveBeenCalledWith({ text: "webstore.deleteError", tone: "info" });
    expect(mockLeave).not.toHaveBeenCalled();
  });
});

it("an unknown id shows not found", async () => {
  await render([webProduct({ id: "p777" })]);
  expect(hasText(tree.root, "webstore.notFound")).toBe(true);
});

describe("photo", () => {
  it("shows the photo block with the app photo of a linked product", async () => {
    await render([linkedProduct({}, { photo_path: "a1/x.jpg" })]);
    expect(hasText(tree.root, "webstore.photoTitle")).toBe(true);
    expect(tree.root.findAllByProps({ testID: "web-app-photo-card" }).length).toBeGreaterThan(0);
  });

  it("offers no app photo to an unlinked product", async () => {
    await render([webProduct()]);
    expect(tree.root.findAllByProps({ testID: "web-app-photo-card" })).toHaveLength(0);
  });

  it("choosing the uploaded photo saves at once, without the form's Save and without deleting", async () => {
    jest.mocked(setImageSource).mockResolvedValue();
    await render([webProduct({ image_url: "https://i/a.jpg", image_path: "p001/1.jpg" })]);
    const file = tree.root.findAll(
      (n) => n.props.accessibilityRole === "radio" && hasText(n, "webstore.photoSourceFile")
    )[0];
    await act(async () => file.props.onPress());
    expect(setImageSource).toHaveBeenCalledWith("p001", "file");
    expect(updateWebProduct).not.toHaveBeenCalled();
    expect(removeWebImageFile).not.toHaveBeenCalled();
    expect(
      tree.root.findAll(
        (n) =>
          n.props.accessibilityRole === "radio" &&
          n.props.accessibilityState?.selected &&
          hasText(n, "webstore.photoSourceFile")
      ).length
    ).toBeGreaterThan(0);
  });

  it("saving the form leaves the chosen source alone (the patch has no photo fields)", async () => {
    await render([
      webProduct({ image_url: "https://i/a.jpg", image_path: "p001/1.jpg", image_source: "file" }),
    ]);
    await press("webstore.save");
    const patch = jest.mocked(updateWebProduct).mock.calls[0][1];
    expect(patch).not.toHaveProperty("image_source");
    expect(patch).not.toHaveProperty("image_path");
  });
});
