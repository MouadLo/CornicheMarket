import React from "react";
import { Linking } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { CatalogRow, ShopRow } from "../../src/lib/competitors/catalog";
import {
  addShop,
  confirmMatch,
  deleteShop,
  fetchCatalogCategories,
  fetchCatalogCounts,
  fetchCatalogPage,
  fetchShops,
  readShopNow,
  rejectMatch,
  rematch,
  setItemDecision,
  updateSourcing,
} from "../../src/lib/competitors/shops";
import { downloadCompetitorImage } from "../../src/lib/competitors/imageDownload";
import { confirm, showToast } from "../../src/lib/dialog/store";
import { exportTablesAsCsv } from "../../src/lib/reports/export";
import { isolateLtr } from "../../src/lib/text/bidi";
import { allTexts, pressableByText, textOf } from "../sales/sellTestUtils";

import Competitors from "../../app/(app)/competitors/index";

let mockRole: "owner" | "cashier" = "owner";
const mockPush = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => mockSearchParams,
  Redirect: ({ href }: { href: string }) => {
    const React = require("react");
    return React.createElement("Redirect", { href });
  },
}));
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
jest.mock("../../src/lib/competitors/queries", () => ({
  fetchCompetitorRows: jest.fn().mockResolvedValue([]),
  applyCompetitorSuggestions: jest.fn(),
}));
jest.mock("../../src/lib/competitors/shops", () => ({
  addShop: jest.fn(),
  confirmMatch: jest.fn(),
  deleteShop: jest.fn(),
  fetchCatalogCategories: jest.fn(),
  fetchCatalogCounts: jest.fn(),
  fetchCatalogPage: jest.fn(),
  fetchShops: jest.fn(),
  readShopNow: jest.fn(),
  rejectMatch: jest.fn(),
  rematch: jest.fn(),
  setItemDecision: jest.fn(),
  updateSourcing: jest.fn(),
}));
jest.mock("../../src/lib/competitors/imageDownload", () => ({
  downloadCompetitorImage: jest.fn(),
}));
jest.mock("../../src/lib/stock/queries", () => ({
  fetchSuppliers: jest.fn().mockResolvedValue([
    { id: "s1", name: "Distrimar", phone: null },
    { id: "s2", name: "Autre", phone: null },
  ]),
}));
jest.mock("../../src/lib/reports/export", () => ({ exportTablesAsCsv: jest.fn() }));
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: ({ onPick }: { onPick: (p: { id: string }) => void }) => {
    const React = require("react");
    return React.createElement("Picker", { onPick });
  },
}));

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  id: "i1",
  shop_id: "sh1",
  shop_name: "Night",
  name: "Lorenz Crunchips Paprika",
  url: "https://night.ma/p/1",
  price_cents: 1200,
  regular_price_cents: 1500,
  on_sale: true,
  in_stock: true,
  low_stock_remaining: null,
  image_url: "https://night.ma/i1.jpg",
  categories: ["Chips"],
  popularity_rank: 3,
  first_seen_at: iso(48),
  last_seen_at: iso(1),
  gone: false,
  decision: "proposed",
  candidate_product_id: "p1",
  candidate_product_name: "Crunchips Paprika 100g",
  candidate_selling_price_cents: 1300,
  match_score: 0.82,
  match_uncertain: false,
  sourcing_note: null,
  sourcing_supplier_id: null,
  sourcing_supplier_name: null,
  sourcing_status: null,
  total_count: 1,
  ...over,
});
const shop = (over: Partial<ShopRow> = {}): ShopRow => ({
  id: "sh1",
  name: "Night",
  base_url: "https://night.ma",
  status: "ok",
  status_detail: null,
  last_sync_started_at: iso(30),
  last_sync_completed_at: iso(30),
  next_page: null,
  total_items: 100,
  created_at: iso(100),
  items_count: 100,
  proposed_count: 2,
  missing_count: 90,
  wanted_count: 1,
  matched_count: 7,
  ...over,
});

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<Competitors />);
  });
};
const texts = () => allTexts(tree.root).join("|");
const press = async (label: string) => {
  await act(async () => {
    await pressableByText(tree.root, label).props.onPress();
  });
};
const ltr = (value: string) => isolateLtr(value);
// A tab's text carries its badge ("…confirm2"): match on the start.
const openTab = async (key: string) => {
  const tab = tree.root
    .findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityRole === "tab")
    .find((n) => textOf(n).startsWith(`competitors.tabs.${key}`));
  if (!tab) throw new Error(`no tab ${key}`);
  await act(async () => {
    await tab.props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  jest.mocked(fetchCatalogCounts).mockResolvedValue({ proposed: 2, missing: 90, wanted: 1 });
  jest.mocked(fetchShops).mockResolvedValue([shop(), shop({ id: "sh2", name: "Other" })]);
  jest.mocked(fetchCatalogCategories).mockResolvedValue(["Chips", "Eau"]);
  jest.mocked(fetchCatalogPage).mockResolvedValue([row()]);
  jest.mocked(confirmMatch).mockResolvedValue("link-1");
  jest.mocked(rejectMatch).mockResolvedValue();
  jest.mocked(setItemDecision).mockResolvedValue();
  jest.mocked(updateSourcing).mockResolvedValue();
});
afterEach(() => act(() => tree.unmount()));

describe("tabs", () => {
  it("shows the five tabs with a count badge on À confirmer and À sourcer", async () => {
    await render();
    const t = texts();
    for (const key of ["tracked", "confirm", "missing", "sourcing", "shops"]) {
      expect(t).toContain(`competitors.tabs.${key}`);
    }
    expect(fetchCatalogCounts).toHaveBeenCalled();
    expect(t).toContain("2");
  });
  it("tabs scroll horizontally (phone width)", async () => {
    await render();
    const scroller = tree.root.find((n) => n.props.accessibilityRole === "tablist");
    expect(scroller.props.horizontal).toBe(true);
  });
  it("a cashier is redirected away and nothing is read", async () => {
    mockRole = "cashier";
    await render();
    expect(tree.root.findAllByType("Redirect" as never)[0].props.href).toBe("/(app)/sell");
    expect(fetchCatalogCounts).not.toHaveBeenCalled();
    expect(fetchCatalogPage).not.toHaveBeenCalled();
    expect(fetchShops).not.toHaveBeenCalled();
  });
  it("a failing count does not break the screen", async () => {
    jest.mocked(fetchCatalogCounts).mockRejectedValue(new Error("x"));
    await render();
    expect(texts()).toContain("competitors.tabs.confirm");
  });
});

describe("À confirmer", () => {
  it("shows our product next to theirs", async () => {
    await render();
    await openTab("confirm");
    expect(fetchCatalogPage).toHaveBeenCalledWith("proposed", expect.anything(), 0);
    const t = texts();
    expect(t).toContain("Crunchips Paprika 100g");
    expect(t).toContain("Lorenz Crunchips Paprika");
    expect(t).toContain("competitors.confirmTab.ours");
  });
  it("marks an uncertain pair", async () => {
    jest.mocked(fetchCatalogPage).mockResolvedValue([row({ match_uncertain: true })]);
    await render();
    await openTab("confirm");
    expect(texts()).toContain("competitors.confirmTab.uncertain");
  });
  it("Confirmer confirms with the proposed product and removes the pair", async () => {
    await render();
    await openTab("confirm");
    await press("competitors.confirmTab.confirm");
    expect(confirmMatch).toHaveBeenCalledWith("i1", "p1");
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "competitors.confirmTab.confirmed" })
    );
    expect(texts()).toContain("competitors.confirmTab.emptyTitle");
  });
  it("Pas le même rejects the pair", async () => {
    await render();
    await openTab("confirm");
    await press("competitors.confirmTab.notSame");
    expect(rejectMatch).toHaveBeenCalledWith("i1");
    expect(confirmMatch).not.toHaveBeenCalled();
  });
  it("Choisir un autre produit confirms with the picked product", async () => {
    await render();
    await openTab("confirm");
    await press("competitors.confirmTab.other");
    const picker = tree.root.findAllByType("Picker" as never)[0];
    await act(async () => {
      await picker.props.onPick({ id: "p9" });
    });
    expect(confirmMatch).toHaveBeenCalledWith("i1", "p9");
  });
  it("explains a product already matched in the shop and keeps the pair", async () => {
    jest.mocked(confirmMatch).mockRejectedValue(new Error("product already matched in this shop"));
    await render();
    await openTab("confirm");
    await press("competitors.confirmTab.confirm");
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "competitors.confirmTab.alreadyMatched" })
    );
    expect(texts()).toContain("Lorenz Crunchips Paprika");
  });
  it("shows the empty state", async () => {
    jest.mocked(fetchCatalogPage).mockResolvedValue([]);
    await render();
    await openTab("confirm");
    expect(texts()).toContain("competitors.confirmTab.emptyTitle");
  });
  it("offers to download the photo", async () => {
    jest.mocked(downloadCompetitorImage).mockResolvedValue("saved");
    await render();
    await openTab("confirm");
    await press("competitors.catalog.downloadPhoto");
    expect(downloadCompetitorImage).toHaveBeenCalledWith(
      "https://night.ma/i1.jpg",
      "Lorenz Crunchips Paprika"
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "competitors.catalog.photoSaved" })
    );
  });
  it("no download button without a photo", async () => {
    jest.mocked(fetchCatalogPage).mockResolvedValue([row({ image_url: null })]);
    await render();
    await openTab("confirm");
    expect(texts()).not.toContain("competitors.catalog.downloadPhoto");
  });
});

describe("Vous ne l'avez pas", () => {
  const missing = (over: Partial<CatalogRow> = {}) =>
    row({
      decision: "missing",
      candidate_product_id: null,
      candidate_product_name: null,
      candidate_selling_price_cents: null,
      ...over,
    });
  beforeEach(() => jest.mocked(fetchCatalogPage).mockResolvedValue([missing()]));

  it("shows photo data, price, promo, stock, category and shop", async () => {
    await render();
    await openTab("missing");
    const t = texts();
    expect(t).toContain("Lorenz Crunchips Paprika");
    expect(t).toContain("competitors.catalog.promoOff" + JSON.stringify({ percent: ltr("20") }));
    expect(t).toContain("competitors.inStock");
    expect(t).toContain(
      "competitors.catalog.inShop" +
        JSON.stringify({ shop: "Night" }) +
        " · competitors.catalog.rank" +
        JSON.stringify({ rank: ltr("3") })
    );
  });
  it("loads by popularity first, then re-queries with the chosen filters and sort", async () => {
    await render();
    await openTab("missing");
    expect(fetchCatalogPage).toHaveBeenLastCalledWith(
      "missing",
      { shopId: null, category: null, inStockOnly: false, promoOnly: false, sort: "popularity" },
      0
    );
    await press("competitors.catalog.filterInStock");
    await press("competitors.catalog.filterPromo");
    await press("competitors.catalog.sortPriceAsc");
    expect(fetchCatalogPage).toHaveBeenLastCalledWith(
      "missing",
      { shopId: null, category: null, inStockOnly: true, promoOnly: true, sort: "price_asc" },
      0
    );
    await press("competitors.catalog.sortPriceDesc");
    expect(jest.mocked(fetchCatalogPage).mock.calls.at(-1)?.[1].sort).toBe("price_desc");
    await press("competitors.catalog.sortNewest");
    expect(jest.mocked(fetchCatalogPage).mock.calls.at(-1)?.[1].sort).toBe("newest");
  });
  it("filters by shop (reloading its categories) and by category", async () => {
    await render();
    await openTab("missing");
    await press("Other");
    expect(fetchCatalogCategories).toHaveBeenLastCalledWith("missing", "sh2");
    expect(jest.mocked(fetchCatalogPage).mock.calls.at(-1)?.[1].shopId).toBe("sh2");
    await press("Eau");
    expect(jest.mocked(fetchCatalogPage).mock.calls.at(-1)?.[1].category).toBe("Eau");
  });
  it("Je le veux moves the item to À sourcer", async () => {
    await render();
    await openTab("missing");
    await press("competitors.missingTab.want");
    expect(setItemDecision).toHaveBeenCalledWith("i1", "wanted");
    expect(texts()).toContain("competitors.missingTab.emptyTitle");
  });
  it("Pas intéressé hides it", async () => {
    await render();
    await openTab("missing");
    await press("competitors.missingTab.ignore");
    expect(setItemDecision).toHaveBeenCalledWith("i1", "ignored");
  });
  it("C'est un produit que j'ai opens the picker and confirms the picked product", async () => {
    await render();
    await openTab("missing");
    await press("competitors.missingTab.have");
    const picker = tree.root.findAllByType("Picker" as never)[0];
    await act(async () => {
      await picker.props.onPick({ id: "p5" });
    });
    expect(confirmMatch).toHaveBeenCalledWith("i1", "p5");
  });
  it("pages through a long list: a second page is requested at the current offset", async () => {
    const first = Array.from({ length: 30 }, (_, i) => missing({ id: `i${i}`, total_count: 45 }));
    const second = Array.from({ length: 15 }, (_, i) => missing({ id: `j${i}`, total_count: 45 }));
    jest.mocked(fetchCatalogPage).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await render();
    await openTab("missing");
    // the first call was made by the "tracked" tab? no: only the missing tab queries pages
    await press("competitors.catalog.loadMore");
    const calls = jest.mocked(fetchCatalogPage).mock.calls.map((c) => c[2]);
    expect(calls).toEqual([0, 30]);
  });
});

describe("À sourcer", () => {
  const wanted = (over: Partial<CatalogRow> = {}) =>
    row({
      decision: "wanted",
      candidate_product_id: null,
      candidate_product_name: null,
      sourcing_note: "demander à Distrimar",
      sourcing_status: "to_ask",
      ...over,
    });
  beforeEach(() => jest.mocked(fetchCatalogPage).mockResolvedValue([wanted()]));

  it("opens straight on À sourcer when sent back there (after Créer le produit)", async () => {
    mockSearchParams = { tab: "sourcing", r: "1" };
    await render();
    expect(fetchCatalogPage).toHaveBeenCalledWith("wanted", expect.anything(), 0);
    expect(texts()).toContain("Lorenz Crunchips Paprika");
    mockSearchParams = {};
  });
  it("loads the wanted items", async () => {
    await render();
    await openTab("sourcing");
    expect(fetchCatalogPage).toHaveBeenCalledWith("wanted", expect.anything(), 0);
    expect(texts()).toContain("Lorenz Crunchips Paprika");
  });
  it("saves note, supplier and status", async () => {
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.status.asked");
    await press("competitors.sourcingTab.supplierChange");
    await press("Distrimar");
    await press("competitors.sourcingTab.save");
    expect(updateSourcing).toHaveBeenCalledWith("i1", {
      note: "demander à Distrimar",
      supplierId: "s1",
      status: "asked",
    });
  });
  it("refuses a note over 300 characters", async () => {
    jest.mocked(fetchCatalogPage).mockResolvedValue([wanted({ sourcing_note: "x".repeat(301) })]);
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.save");
    expect(updateSourcing).not.toHaveBeenCalled();
    expect(texts()).toContain("competitors.sourcingTab.noteTooLong");
  });
  it("Partager opens WhatsApp with the name, their price and the note", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.share");
    const url = open.mock.calls[0][0];
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(url.slice("https://wa.me/?text=".length));
    expect(text).toContain("Lorenz Crunchips Paprika");
    expect(text).toContain(
      "competitors.sourcingTab.shareTheirPrice" + JSON.stringify({ price: "12.00 DH" })
    );
    expect(text).toContain("demander à Distrimar");
    open.mockRestore();
  });
  it("shares only the selected items", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest
      .mocked(fetchCatalogPage)
      .mockResolvedValue([wanted(), wanted({ id: "i2", name: "Autre produit" })]);
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.select" + JSON.stringify({ name: "Autre produit" }));
    await press("competitors.sourcingTab.shareSelected" + JSON.stringify({ count: 1 }));
    const text = decodeURIComponent(open.mock.calls[0][0].slice("https://wa.me/?text=".length));
    expect(text).toContain("Autre produit");
    expect(text).not.toContain("Lorenz");
    open.mockRestore();
  });
  it("without a selection, shares and exports every wanted item, not only the loaded page", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const first = Array.from({ length: 30 }, (_, i) =>
      wanted({ id: `a${i}`, name: `Produit A${i}`, total_count: 32 })
    );
    const second = [
      wanted({ id: "b0", name: "Produit B0", total_count: 32 }),
      wanted({ id: "b1", name: "Produit B1", total_count: 32 }),
    ];
    jest.mocked(fetchCatalogPage).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.share");
    expect(jest.mocked(fetchCatalogPage).mock.calls.map((c) => c[2])).toEqual([0, 30]);
    const text = decodeURIComponent(open.mock.calls[0][0].slice("https://wa.me/?text=".length));
    expect(text).toContain("Produit A0");
    expect(text).toContain("Produit B1");
    open.mockRestore();
  });
  it("exports a CSV", async () => {
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.exportCsv");
    expect(exportTablesAsCsv).toHaveBeenCalledTimes(1);
    const [, tables] = jest.mocked(exportTablesAsCsv).mock.calls[0];
    expect(tables[0].rows[0][0]).toBe("Lorenz Crunchips Paprika");
    expect(tables[0].rows[0][1]).toBe("12.00");
  });
  it("Créer le produit opens the new product screen with the item and the name", async () => {
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.createProduct");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/products/new",
      params: { competitorItemId: "i1", name: "Lorenz Crunchips Paprika" },
    });
  });
  it("Retirer de la liste puts the item back", async () => {
    await render();
    await openTab("sourcing");
    await press("competitors.sourcingTab.remove");
    expect(setItemDecision).toHaveBeenCalledWith("i1", "missing");
  });
});

describe("Boutiques", () => {
  it("lists the shops with status, counts and last read", async () => {
    await render();
    await openTab("shops");
    const t = texts();
    expect(t).toContain("Night");
    expect(t).toContain("competitors.shops.status.ok");
    expect(t).toContain(
      "competitors.shops.counts" +
        JSON.stringify({ proposed: ltr("2"), missing: ltr("90"), wanted: ltr("1") })
    );
  });
  it("shows why a refused shop was refused", async () => {
    jest
      .mocked(fetchShops)
      .mockResolvedValue([shop({ status: "refused", status_detail: "robots_disallow" })]);
    await render();
    await openTab("shops");
    expect(texts()).toContain("competitors.shopReason.robots_disallow");
  });
  it("adds a shop", async () => {
    jest
      .mocked(addShop)
      .mockResolvedValue({ status: "added", shopId: "sh3", read: { status: "ok", items: 1511 } });
    await render();
    await openTab("shops");
    const fields = tree.root.findAll(
      (n) => n.props.placeholder === "competitors.shops.urlPlaceholder"
    );
    await act(async () => {
      fields[0].props.onChangeText("yournightshop.ma");
    });
    await press("competitors.shops.add");
    expect(addShop).toHaveBeenCalledWith("yournightshop.ma", "");
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "competitors.shops.readDone" + JSON.stringify({ count: ltr("1511") }),
      })
    );
  });
  it("explains why a shop cannot be added", async () => {
    jest.mocked(addShop).mockResolvedValue({ status: "rejected", reason: "not_woocommerce" });
    await render();
    await openTab("shops");
    const fields = tree.root.findAll(
      (n) => n.props.placeholder === "competitors.shops.urlPlaceholder"
    );
    await act(async () => {
      fields[0].props.onChangeText("blog.example.com");
    });
    await press("competitors.shops.add");
    expect(texts()).toContain("competitors.shopReason.not_woocommerce");
  });
  it("Lire maintenant reads the shop and says when it was too soon", async () => {
    jest.mocked(readShopNow).mockResolvedValue({ status: "rate_limited", retryAfterSeconds: 1800 });
    await render();
    await openTab("shops");
    await press("competitors.shops.readNow");
    expect(readShopNow).toHaveBeenCalledWith("sh1", expect.any(Function));
    expect(texts()).toContain("competitors.shops.tooSoon" + JSON.stringify({ minutes: ltr("30") }));
  });
  it("Lire maintenant stays available while a read is in progress, so it can be resumed", async () => {
    jest.mocked(fetchShops).mockResolvedValue([shop({ status: "syncing", next_page: 7 })]);
    jest.mocked(readShopNow).mockResolvedValue({ status: "ok", items: 1511 });
    await render();
    await openTab("shops");
    const button = pressableByText(tree.root, "competitors.shops.readNow");
    expect(button.props.disabled).toBeFalsy();
    await press("competitors.shops.readNow");
    expect(readShopNow).toHaveBeenCalledWith("sh1", expect.any(Function));
  });
  it("adding a shop whose first read ran out of time continues it", async () => {
    jest.mocked(addShop).mockResolvedValue({
      status: "added",
      shopId: "sh3",
      read: { status: "syncing", nextPage: 9 },
    });
    jest.mocked(readShopNow).mockResolvedValue({ status: "ok", items: 1511 });
    await render();
    await openTab("shops");
    const fields = tree.root.findAll(
      (n) => n.props.placeholder === "competitors.shops.urlPlaceholder"
    );
    await act(async () => {
      fields[0].props.onChangeText("yournightshop.ma");
    });
    await press("competitors.shops.add");
    expect(readShopNow).toHaveBeenCalledWith("sh3");
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "competitors.shops.readDone" + JSON.stringify({ count: ltr("1511") }),
      })
    );
  });
  it("deleting asks first and calls deleteShop only after a yes", async () => {
    jest.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await render();
    await openTab("shops");
    await press("competitors.shops.delete");
    expect(deleteShop).not.toHaveBeenCalled();
    await press("competitors.shops.delete");
    expect(deleteShop).toHaveBeenCalledWith("sh1");
  });
  it("Recalculer les correspondances makes no shop read", async () => {
    jest.mocked(rematch).mockResolvedValue(5);
    await render();
    await openTab("shops");
    await press("competitors.shops.recalc");
    expect(rematch).toHaveBeenCalledWith();
    expect(readShopNow).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "competitors.shops.recalcDone" + JSON.stringify({ count: ltr("5") }),
      })
    );
  });
});
