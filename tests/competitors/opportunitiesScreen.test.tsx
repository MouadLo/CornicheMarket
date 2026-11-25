import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { OverviewRow } from "../../src/lib/competitors/overview";
import {
  applyCompetitorSuggestions,
  fetchCompetitorRows,
  setPriceCheck,
} from "../../src/lib/competitors/queries";
import { confirm, showToast } from "../../src/lib/dialog/store";
import { undoPriceChange } from "../../src/lib/products/queries";
import { allTexts, textOf } from "../sales/sellTestUtils";

import CompetitorPrices from "../../app/(app)/competitors/index";

let mockRole: "owner" | "cashier" = "owner";
const mockPush = jest.fn();
let mockSearchParams: Record<string, string> = { tab: "opportunities" };

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
  fetchCompetitorRows: jest.fn(),
  applyCompetitorSuggestions: jest.fn(),
  setPriceCheck: jest.fn(),
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
  product_name: "Coca",
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
  title: "x",
  image_url: null,
  observed_at: hoursAgo(1),
  price_check: false,
  sold_30d: 0,
};
const rows: OverviewRow[] = [
  // Tagged and dearer: 12.00 vs 10.00 -> "Mettre à 10.00 DH"
  { ...base, price_check: true, sold_30d: 5 },
  // Tagged, dearer, theirs below our cost: no apply, hint
  {
    ...base,
    product_id: "p1b",
    product_name: "Cigarettes",
    link_id: "l1b",
    price_check: true,
    price_cents: 700,
  },
  // Cheaper: 8.00 vs 10.00 -> target 9.50, 20 sold -> +30.00 DH
  {
    ...base,
    product_id: "p2",
    product_name: "Lait",
    link_id: "l2",
    selling_price_cents: 800,
    cost_cents: 500,
    sold_30d: 20,
  },
  // Cheaper with no sale in 30 days
  {
    ...base,
    product_id: "p4",
    product_name: "Riz",
    link_id: "l4",
    selling_price_cents: 800,
    cost_cents: 500,
    sold_30d: 0,
  },
  // Best seller, untagged, dearer: a price-check suggestion
  { ...base, product_id: "p3", product_name: "Eau", link_id: "l3", sold_30d: 50 },
];

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<CompetitorPrices />);
  });
};
const texts = () => allTexts(tree.root).join("|");
const pressStarting = async (prefix: string, index = 0) => {
  const found = tree.root.findAll(
    (n) => typeof n.props.onPress === "function" && textOf(n).startsWith(prefix)
  );
  if (!found[index]) throw new Error(`no pressable starting with "${prefix}"`);
  await act(async () => {
    await found[index].props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  mockSearchParams = { tab: "opportunities" };
  jest.mocked(fetchCompetitorRows).mockResolvedValue(rows);
  jest.mocked(applyCompetitorSuggestions).mockResolvedValue({ batchId: "b1", changed: 1 });
  jest.mocked(setPriceCheck).mockResolvedValue();
  jest.mocked(confirm).mockResolvedValue(true);
});
afterEach(() => act(() => tree.unmount()));

it("renders the three sections from the rows", async () => {
  await render();
  const shown = texts();
  expect(shown).toContain("competitors.opp.alertsTitle");
  expect(shown).toContain('competitors.opp.moneyTitle{"gain":"');
  expect(shown).toContain("30.00 DH");
  expect(shown).toContain("competitors.opp.suggestTitle");
  // alerts: both tagged products; the below-cost one has the hint, not a button
  expect(shown).toContain("Coca");
  expect(shown).toContain("Cigarettes");
  expect(shown).toContain("competitors.opp.belowCost");
  expect(shown).toContain('competitors.opp.setPrice{"price":"');
  // money on the table
  expect(shown).toContain("Lait");
  expect(shown).toContain('competitors.opp.raiseTo{"price":"');
  expect(shown).toContain('competitors.opp.noSales{"count":1}');
  // suggestions: best seller first
  expect(shown).toContain("Eau");
  expect(shown).toContain("competitors.opp.markAsCheck");
  expect(shown.indexOf("Eau")).toBeLessThan(shown.lastIndexOf("Lait"));
});

it("shows an empty state in each section when there is nothing to do", async () => {
  jest.mocked(fetchCompetitorRows).mockResolvedValue([]);
  await render();
  const shown = texts();
  expect(shown).toContain("competitors.opp.alertsEmpty");
  expect(shown).toContain("competitors.opp.moneyEmpty");
  // No gain: a plain heading, not "+0.00 DH / month".
  expect(shown).toContain("competitors.opp.moneyTitlePlain");
  expect(shown).not.toContain("competitors.opp.moneyTitle{");
  expect(shown).toContain("competitors.opp.suggestEmpty");
});

it("a failed load shows the error", async () => {
  jest.mocked(fetchCompetitorRows).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await render();
  expect(texts()).toContain("competitors.loadErrorScreen");
});

it("'Mettre à X' confirms old -> new, then applies through the apply flow and reloads", async () => {
  await render();
  await pressStarting("competitors.opp.setPrice");
  const options = jest.mocked(confirm).mock.calls[0][0];
  expect(options.summary).toBe("Coca");
  expect(options.consequences?.[0].before).toContain("12.00 DH");
  expect(options.consequences?.[0].after).toContain("10.00 DH");
  expect(applyCompetitorSuggestions).toHaveBeenCalledWith([{ productId: "p1", priceCents: 1000 }]);
  expect(jest.mocked(showToast).mock.calls[0][0].text).toBe("competitors.applied");
  // reloaded after the change
  expect(fetchCompetitorRows).toHaveBeenCalledTimes(2);
});

it("'Passer à X' applies the target (their price - 0.50 DH)", async () => {
  await render();
  await pressStarting("competitors.opp.raiseTo");
  expect(jest.mocked(confirm).mock.calls[0][0].consequences?.[0].after).toContain("9.50 DH");
  expect(applyCompetitorSuggestions).toHaveBeenCalledWith([{ productId: "p2", priceCents: 950 }]);
});

it("cancelling the confirm changes nothing", async () => {
  jest.mocked(confirm).mockResolvedValue(false);
  await render();
  await pressStarting("competitors.opp.raiseTo");
  expect(applyCompetitorSuggestions).not.toHaveBeenCalled();
});

it("'Marquer comme repère' saves price_check = true and refreshes", async () => {
  await render();
  await pressStarting("competitors.opp.markAsCheck");
  expect(setPriceCheck).toHaveBeenCalledWith("p3", true);
  expect(fetchCompetitorRows).toHaveBeenCalledTimes(2);
});

it("a failed tag shows a message instead of crashing", async () => {
  jest.mocked(setPriceCheck).mockRejectedValue(new Error("boom"));
  await render();
  await pressStarting("competitors.opp.markAsCheck");
  expect(jest.mocked(showToast).mock.calls[0][0].tone).toBe("info");
});

it("opens a product's competitor page from its name", async () => {
  await render();
  await pressStarting("Lait");
  expect(mockPush).toHaveBeenCalledWith("/(app)/competitors/p2");
});

it("the tab is listed right after Suivis", async () => {
  await render();
  const labels = tree.root
    .findAll((n) => n.props.accessibilityRole === "tab")
    .map((n) => textOf(n));
  expect([...new Set(labels)].slice(0, 2)).toEqual([
    "competitors.tabs.tracked",
    "competitors.tabs.opportunities",
  ]);
});
