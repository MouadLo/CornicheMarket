import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { CompetitorSection } from "../../src/components/competitors/CompetitorSection";
import type { OverviewRow } from "../../src/lib/competitors/overview";
import {
  addCompetitorLink,
  checkCompetitorLink,
  fetchCompetitorRows,
  fetchProductMarginFloor,
  removeCompetitorLink,
  saveManualPrice,
  setProductMarginFloor,
} from "../../src/lib/competitors/queries";
import { downloadCompetitorImage } from "../../src/lib/competitors/imageDownload";
import { confirm } from "../../src/lib/dialog/store";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

let mockRole: "owner" | "cashier" = "owner";

jest.mock("react-i18next", () => {
  const t = (key: string, values?: object) => key + (values ? JSON.stringify(values) : "");
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
jest.mock("../../src/lib/dialog/store", () => ({ confirm: jest.fn(), showToast: jest.fn() }));
jest.mock("../../src/lib/competitors/imageDownload", () => ({
  downloadCompetitorImage: jest.fn(),
}));
jest.mock("../../src/lib/competitors/queries", () => ({
  fetchCompetitorRows: jest.fn(),
  addCompetitorLink: jest.fn(),
  checkCompetitorLink: jest.fn(),
  removeCompetitorLink: jest.fn(),
  saveManualPrice: jest.fn(),
  fetchProductMarginFloor: jest.fn(),
  setProductMarginFloor: jest.fn(),
}));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const row = (over: Partial<OverviewRow> = {}): OverviewRow => ({
  product_id: "p1",
  product_name: "Chips",
  unit: "piece",
  selling_price_cents: 1200,
  cost_cents: 800,
  min_margin_percent: 15,
  margin_override: null,
  link_id: "l1",
  shop_name: "Yournightshop",
  url: "https://yournightshop.ma/product/chips/",
  mode: "auto",
  last_status: "ok",
  last_status_detail: null,
  last_checked_at: hoursAgo(2),
  last_ok_at: hoursAgo(2),
  price_cents: 1800,
  regular_price_cents: 2000,
  on_sale: true,
  in_stock: true,
  low_stock_remaining: 3,
  title: "Lorenz Crunchips Paprika",
  image_url: "https://yournightshop.ma/img.jpg",
  observed_at: hoursAgo(2),
  ...over,
});

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<CompetitorSection productId="p1" />);
  });
};
const texts = () => allTexts(tree.root);
const input = (label: string) =>
  tree.root.find(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onChangeText === "function"
  );
const type = async (label: string, value: string) => {
  await act(async () => {
    input(label).props.onChangeText(value);
  });
};
const press = async (label: string) => {
  await act(async () => {
    await pressableByText(tree.root, label).props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  jest.mocked(fetchCompetitorRows).mockResolvedValue([row()]);
  jest.mocked(fetchProductMarginFloor).mockResolvedValue({ override: null, storePercent: 15 });
});
afterEach(() => act(() => tree.unmount()));

it("shows each link with shop, title, price, promo, regular price, stock, freshness and mode", async () => {
  await render();
  expect(fetchCompetitorRows).toHaveBeenCalledWith("p1");
  const shown = texts().join("|");
  expect(shown).toContain("Yournightshop");
  expect(shown).toContain("Lorenz Crunchips Paprika");
  expect(shown).toContain("18.00");
  expect(shown).toContain("competitors.promo");
  expect(shown).toContain("20.00 DH");
  expect(shown).toContain("competitors.inStock");
  expect(shown).toContain("competitors.modeAuto");
  expect(shown).toContain("competitors.lowStock");
  expect(shown).toContain("competitors.agoHours");
  expect(
    tree.root.findAll((n) => n.props.source?.uri === "https://yournightshop.ma/img.jpg").length
  ).toBeGreaterThan(0);
});

it("a cashier sees nothing and nothing is read", async () => {
  mockRole = "cashier";
  await render();
  expect(tree.toJSON()).toBeNull();
  expect(fetchCompetitorRows).not.toHaveBeenCalled();
  expect(fetchProductMarginFloor).not.toHaveBeenCalled();
});

it("shows an empty message when the product has no link", async () => {
  jest.mocked(fetchCompetitorRows).mockResolvedValue([]);
  await render();
  expect(texts()).toContain("competitors.empty");
});

it("a failed read shows an error with retry, not an empty list", async () => {
  jest.mocked(fetchCompetitorRows).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await render();
  expect(texts().join(" ")).toContain("errors.network");
  expect(texts()).not.toContain("competitors.empty");
  await press("common.retry");
  expect(texts()).toContain("Yournightshop");
});

it("Vérifier asks the function to check that link", async () => {
  jest.mocked(checkCompetitorLink).mockResolvedValue({ status: "ok" });
  await render();
  await press("competitors.check");
  expect(checkCompetitorLink).toHaveBeenCalledWith("l1", false);
  expect(fetchCompetitorRows).toHaveBeenCalledTimes(2);
});

it("Vérifier too soon says when to retry", async () => {
  jest
    .mocked(checkCompetitorLink)
    .mockResolvedValue({ status: "rate_limited", retryAfterSeconds: 300 });
  await render();
  await press("competitors.check");
  expect(texts().join("|")).toContain('competitors.tooSoon{"minutes":');
});

it("deleting asks first, then removes the link", async () => {
  jest.mocked(confirm).mockResolvedValue(true);
  await render();
  await press("competitors.remove");
  expect(confirm).toHaveBeenCalled();
  expect(removeCompetitorLink).toHaveBeenCalledWith("l1");
});
it("deleting does nothing when the owner says no", async () => {
  jest.mocked(confirm).mockResolvedValue(false);
  await render();
  await press("competitors.remove");
  expect(removeCompetitorLink).not.toHaveBeenCalled();
});

describe("a manual link", () => {
  const manual = row({
    mode: "manual",
    last_status: "refused",
    last_status_detail: "http_429",
    price_cents: 1500,
    regular_price_cents: 1500,
    on_sale: false,
  });
  beforeEach(() => jest.mocked(fetchCompetitorRows).mockResolvedValue([manual]));

  it("shows the reason it is manual and a price field", async () => {
    await render();
    const shown = texts().join("|");
    expect(shown).toContain("competitors.modeManual");
    expect(shown).toContain("competitors.statusRefused");
    expect(shown).toContain("competitors.reason.http_429");
    expect(input("competitors.manualPriceLabel").props.value).toBe("15.00");
    expect(shown).toContain("competitors.retryAuto");
  });
  it("saves the typed price and the out-of-stock flag", async () => {
    await render();
    await type("competitors.manualPriceLabel", "12,50");
    await press("competitors.manualSave");
    expect(saveManualPrice).toHaveBeenCalledWith("l1", { priceCents: 1250, inStock: true });
    expect(texts()).toContain("competitors.manualSaved");
  });
  it("saves out of stock without a price", async () => {
    await render();
    await type("competitors.manualPriceLabel", "");
    await act(async () => {
      tree.root
        .find(
          (n) =>
            n.props.accessibilityLabel === "competitors.manualOutOfStock" && n.props.onValueChange
        )
        .props.onValueChange(true);
    });
    await press("competitors.manualSave");
    expect(saveManualPrice).toHaveBeenCalledWith("l1", { priceCents: null, inStock: false });
  });
  it("refuses an invalid price", async () => {
    await render();
    await type("competitors.manualPriceLabel", "abc");
    await press("competitors.manualSave");
    expect(saveManualPrice).not.toHaveBeenCalled();
    expect(texts().join(" ")).toContain("competitors.manualPriceInvalid");
  });
  it("a Glovo-like app-only link offers no retry", async () => {
    jest.mocked(fetchCompetitorRows).mockResolvedValue([
      row({
        mode: "manual",
        last_status: "manual",
        last_status_detail: "app_only_site",
        price_cents: null,
        in_stock: null,
        observed_at: null,
      }),
    ]);
    await render();
    expect(texts()).not.toContain("competitors.retryAuto");
    expect(texts().join("|")).toContain("competitors.reason.app_only_site");
  });
});

describe("add link form", () => {
  it("rejects a non-https address and an empty shop without calling anything", async () => {
    await render();
    await type("competitors.shopLabel", "Shop");
    await type("competitors.urlLabel", "http://plain.example/x");
    await press("competitors.add");
    expect(addCompetitorLink).not.toHaveBeenCalled();
    expect(texts()).toContain("competitors.errUrl");

    await type("competitors.shopLabel", "  ");
    await type("competitors.urlLabel", "https://ok.example/x");
    await press("competitors.add");
    expect(addCompetitorLink).not.toHaveBeenCalled();
    expect(texts()).toContain("competitors.errShop");
  });
  it("adds the link and shows what was found so the owner can confirm it", async () => {
    jest.mocked(addCompetitorLink).mockResolvedValue({
      linkId: "l9",
      check: {
        status: "ok",
        reading: {
          title: "Lorenz Crunchips Paprika",
          priceCents: 1800,
          regularPriceCents: 1800,
          onSale: false,
          inStock: true,
          lowStockRemaining: null,
          imageUrl: null,
        },
      },
    });
    await render();
    await type("competitors.shopLabel", " Nightshop ");
    await type("competitors.urlLabel", "https://yournightshop.ma/product/x/");
    await press("competitors.add");
    expect(addCompetitorLink).toHaveBeenCalledWith(
      "p1",
      "Nightshop",
      "https://yournightshop.ma/product/x/"
    );
    const shown = texts().join("|");
    expect(shown).toContain('competitors.found{"title":"Lorenz Crunchips Paprika"}');
    expect(shown).toContain("competitors.foundConfirm");
  });
  it("explains a refusal and that the price is typed by hand", async () => {
    jest.mocked(addCompetitorLink).mockResolvedValue({
      linkId: "l9",
      check: { status: "refused", detail: "robots_disallow" },
    });
    await render();
    await type("competitors.shopLabel", "Shop");
    await type("competitors.urlLabel", "https://shop.example/p");
    await press("competitors.add");
    const shown = texts().join("|");
    expect(shown).toContain("competitors.foundManual");
    expect(shown).toContain("competitors.reason.robots_disallow");
  });
  it("shows a translated error when the link already exists", async () => {
    jest
      .mocked(addCompetitorLink)
      .mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    await render();
    await type("competitors.shopLabel", "Shop");
    await type("competitors.urlLabel", "https://shop.example/p");
    await press("competitors.add");
    expect(texts().join(" ")).toContain("errors.duplicate");
    expect(texts().join(" ")).not.toContain("violates");
  });
});

describe("minimum margin override", () => {
  it("shows the store margin as the hint and saves a product override", async () => {
    await render();
    expect(texts().join("|")).toContain('competitors.marginHint{"percent":');
    await type("competitors.marginLabel", "5");
    await press("competitors.marginSave");
    expect(setProductMarginFloor).toHaveBeenCalledWith("p1", 5);
  });
  it("an empty field removes the override", async () => {
    jest.mocked(fetchProductMarginFloor).mockResolvedValue({ override: 5, storePercent: 15 });
    await render();
    expect(input("competitors.marginLabel").props.value).toBe("5");
    await type("competitors.marginLabel", "");
    await press("competitors.marginSave");
    expect(setProductMarginFloor).toHaveBeenCalledWith("p1", null);
  });
  it("refuses a percentage above 95", async () => {
    await render();
    await type("competitors.marginLabel", "120");
    await press("competitors.marginSave");
    expect(setProductMarginFloor).not.toHaveBeenCalled();
    expect(texts()).toContain("competitors.marginInvalid");
  });
});

it("offers to download the competitor photo of a link, named after what the shop calls the product", async () => {
  jest.mocked(downloadCompetitorImage).mockResolvedValue("saved");
  await render();
  await press("competitors.catalog.downloadPhoto");
  expect(downloadCompetitorImage).toHaveBeenCalledWith(
    "https://yournightshop.ma/img.jpg",
    "Lorenz Crunchips Paprika"
  );
});

it("no download action when the link has no photo", async () => {
  jest.mocked(fetchCompetitorRows).mockResolvedValue([row({ image_url: null })]);
  await render();
  expect(texts()).not.toContain("competitors.catalog.downloadPhoto");
});
