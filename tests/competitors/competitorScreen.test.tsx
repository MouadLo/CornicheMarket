import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { OverviewRow } from "../../src/lib/competitors/overview";
import { applyCompetitorSuggestions, fetchCompetitorRows } from "../../src/lib/competitors/queries";
import { showToast } from "../../src/lib/dialog/store";
import { undoPriceChange } from "../../src/lib/products/queries";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

import CompetitorPrices from "../../app/(app)/competitors/index";

let mockRole: "owner" | "cashier" = "owner";
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
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
  fetchCompetitorRows: jest.fn(),
  applyCompetitorSuggestions: jest.fn(),
}));
jest.mock("../../src/lib/products/queries", () => ({ undoPriceChange: jest.fn() }));
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: ({ onPick }: { onPick: (p: { id: string }) => void }) => {
    const React = require("react");
    return React.createElement("Picker", { onPick });
  },
}));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const base: OverviewRow = {
  product_id: "p1",
  product_name: "Chips",
  unit: "piece",
  selling_price_cents: 1200,
  cost_cents: 800,
  min_margin_percent: 15,
  margin_override: null,
  link_id: "l1",
  shop_name: "Yournightshop",
  url: "https://a.ma/x",
  mode: "auto",
  last_status: "ok",
  last_status_detail: null,
  last_checked_at: hoursAgo(1),
  last_ok_at: hoursAgo(1),
  price_cents: 1000,
  regular_price_cents: 1000,
  on_sale: false,
  in_stock: true,
  low_stock_remaining: null,
  title: "Chips",
  image_url: null,
  observed_at: hoursAgo(1),
};
const rows: OverviewRow[] = [
  // lower: competitor 10.00, cost 8.00 -> 20 % margin
  base,
  // floor: competitor 9.00 on a promo, matching gives 11.1 % < 15 %
  {
    ...base,
    product_id: "p2",
    product_name: "Eau",
    link_id: "l2",
    shop_name: "Shop B",
    price_cents: 900,
    regular_price_cents: 1200,
    on_sale: true,
  },
  // could_raise: ours 8.00 vs 10.00
  {
    ...base,
    product_id: "p3",
    product_name: "Lait",
    link_id: "l3",
    selling_price_cents: 800,
    cost_cents: 500,
  },
  // dont_follow: competitor below our cost
  { ...base, product_id: "p4", product_name: "Cola", link_id: "l4", price_cents: 700 },
  // ok: same price
  { ...base, product_id: "p5", product_name: "Pain", link_id: "l5", selling_price_cents: 1000 },
  // no_cost
  { ...base, product_id: "p6", product_name: "Riz", link_id: "l6", cost_cents: null },
  // competitor out of stock -> no_data, shown by the "rupture" filter
  { ...base, product_id: "p7", product_name: "Thé", link_id: "l7", in_stock: false },
];

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<CompetitorPrices />);
  });
};
const texts = () => allTexts(tree.root).join("|");
const press = async (label: string) => {
  await act(async () => {
    await pressableByText(tree.root, label).props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  jest.mocked(fetchCompetitorRows).mockResolvedValue(rows);
  jest.mocked(applyCompetitorSuggestions).mockResolvedValue({ batchId: "b1", changed: 1 });
});
afterEach(() => act(() => tree.unmount()));

it("a cashier is sent back and nothing is read", async () => {
  mockRole = "cashier";
  await render();
  expect(tree.root.findAllByType("Redirect" as never)[0].props.href).toBe("/(app)/sell");
  expect(fetchCompetitorRows).not.toHaveBeenCalled();
});

it("shows an empty state that explains how to add links, with the follow button", async () => {
  jest.mocked(fetchCompetitorRows).mockResolvedValue([]);
  await render();
  expect(texts()).toContain("competitors.followProduct");
  expect(texts()).toContain("competitors.emptyTitle");
  expect(texts()).toContain("competitors.emptyHint");
});

it("a failed load shows the error, not the empty state", async () => {
  jest.mocked(fetchCompetitorRows).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await render();
  expect(texts()).toContain("competitors.loadErrorScreen");
  expect(texts()).not.toContain("competitors.emptyTitle");
});

it("À revoir lists only the products with a suggestion", async () => {
  await render();
  const shown = texts();
  expect(shown).toContain("Chips");
  expect(shown).toContain("Eau");
  expect(shown).toContain("Lait");
  for (const hidden of ["Cola", "Pain", "Riz", "Thé"]) expect(shown).not.toContain(hidden);
});

it("renders each outcome with its suggested price and reason", async () => {
  await render();
  await press("competitors.filterAll");
  const shown = texts();
  expect(shown).toContain('competitors.outcome.lower{"price":"');
  expect(shown).toContain("10.00 DH");
  expect(shown).toContain('competitors.outcome.floor{"price":"');
  expect(shown).toContain("9.50 DH");
  expect(shown).toContain('competitors.outcome.raise{"price":"');
  expect(shown).toContain("9.50 DH");
  expect(shown).toContain("competitors.outcome.dontFollow");
  expect(shown).toContain("competitors.outcome.ok");
  expect(shown).toContain("competitors.outcome.noCost");
  expect(shown).toContain("competitors.outcome.noData");
  expect(shown).toContain("competitors.why.dontFollow");
  expect(shown).toContain('competitors.why.lower{"margin":');
  expect(shown).toContain("competitors.why.floor{");
  expect(shown).toContain("competitors.promo");
});

it("the Concurrent en rupture filter shows products with an out-of-stock link", async () => {
  await render();
  await press("competitors.filterOut");
  expect(texts()).toContain("Thé");
  expect(texts()).not.toContain("Chips");
});

it("Apply sends the suggested price of that product and offers an undo", async () => {
  await render();
  const applyButtons = tree.root.findAll(
    (n) =>
      typeof n.props.onPress === "function" &&
      n.props.children !== undefined &&
      allTexts(n).join("") === "competitors.apply"
  );
  expect(applyButtons.length).toBeGreaterThanOrEqual(3);
  await act(async () => {
    await applyButtons[0].props.onPress();
  });
  expect(applyCompetitorSuggestions).toHaveBeenCalledTimes(1);
  expect(applyCompetitorSuggestions).toHaveBeenCalledWith([{ productId: "p1", priceCents: 1000 }]);
  const toast = jest.mocked(showToast).mock.calls[0][0];
  expect(toast.text).toBe("competitors.applied");
  expect(toast.action?.label).toBe("competitors.applyUndo");
  jest.mocked(undoPriceChange).mockResolvedValue({ restored: 1, skipped: 0 });
  await act(async () => {
    toast.action?.onPress();
  });
  expect(undoPriceChange).toHaveBeenCalledWith("b1");
});

it("Appliquer la sélection applies several products in one call", async () => {
  jest.mocked(applyCompetitorSuggestions).mockResolvedValue({ batchId: "b2", changed: 3 });
  await render();
  const boxes = tree.root.findAll((n) => n.props.accessibilityRole === "checkbox", { deep: false });
  expect(boxes).toHaveLength(3);
  await act(async () => {
    boxes[0].props.onPress();
    boxes[1].props.onPress();
  });
  expect(texts()).toContain('competitors.applySelected{"count":2}');
  await press('competitors.applySelected{"count":2}');
  expect(applyCompetitorSuggestions).toHaveBeenCalledTimes(1);
  expect(applyCompetitorSuggestions).toHaveBeenCalledWith([
    { productId: "p1", priceCents: 1000 },
    { productId: "p2", priceCents: 950 },
  ]);
  expect(jest.mocked(showToast).mock.calls[0][0].text).toBe('competitors.appliedMany{"count":3}');
});

it("tells the owner when no price actually changed", async () => {
  jest.mocked(applyCompetitorSuggestions).mockResolvedValue({ batchId: null, changed: 0 });
  await render();
  const first = tree.root.findAll(
    (n) => typeof n.props.onPress === "function" && allTexts(n).join("") === "competitors.apply"
  )[0];
  await act(async () => {
    await first.props.onPress();
  });
  expect(jest.mocked(showToast).mock.calls[0][0].text).toBe("competitors.appliedNothing");
});

it("opens the product's competitor page when its name is pressed", async () => {
  await render();
  await press("Chips");
  expect(mockPush).toHaveBeenCalledWith("/(app)/competitors/p1");
});

it("Suivre un produit opens a picker, and picking a product opens its competitor page", async () => {
  await render();
  expect(tree.root.findAllByType("Picker" as never)).toHaveLength(0);
  await press("competitors.followProduct");
  const picker = tree.root.findByType("Picker" as never);
  await act(async () => picker.props.onPick({ id: "p9" }));
  expect(mockPush).toHaveBeenCalledWith("/(app)/competitors/p9");
});
