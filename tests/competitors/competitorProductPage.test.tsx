import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { OverviewRow } from "../../src/lib/competitors/overview";
import { applyCompetitorSuggestions, fetchCompetitorRows } from "../../src/lib/competitors/queries";
import { fetchProduct } from "../../src/lib/products/queries";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

import CompetitorProduct from "../../app/(app)/competitors/[productId]";

let mockRole: "owner" | "cashier" = "owner";
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({ productId: "p1" }),
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
  fetchProductMarginFloor: jest.fn().mockResolvedValue({ override: null, storePercent: 15 }),
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProduct: jest.fn(),
  undoPriceChange: jest.fn(),
}));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const row: OverviewRow = {
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
  price_check: false,
  sold_30d: 0,
};

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<CompetitorProduct />);
  });
};
const texts = () => allTexts(tree.root).join("|");

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  jest.mocked(fetchCompetitorRows).mockResolvedValue([row]);
  jest.mocked(fetchProduct).mockResolvedValue({
    id: "p1",
    name: "Chips",
    selling_price_cents: 1200,
    current_cost_cents: 800,
  } as never);
  jest.mocked(applyCompetitorSuggestions).mockResolvedValue({ batchId: "b1", changed: 1 });
});
afterEach(() => act(() => tree.unmount()));

it("a cashier is sent back and nothing is read", async () => {
  mockRole = "cashier";
  await render();
  expect(tree.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
  expect(fetchCompetitorRows).not.toHaveBeenCalled();
  expect(fetchProduct).not.toHaveBeenCalled();
});

it("shows the product header, the decision and the links section", async () => {
  await render();
  const shown = texts();
  expect(shown).toContain("Chips");
  expect(shown).toContain("12.00 DH");
  expect(shown).toContain("8.00 DH");
  expect(shown).toContain("competitors.margin");
  expect(shown).toContain('competitors.outcome.lower{"price":"');
  expect(shown).toContain("competitors.apply");
  expect(shown).toContain("competitors.sectionTitle");
  expect(shown).toContain("competitors.viewProduct");
});

it("Apply sends that product's suggested price", async () => {
  await render();
  await act(async () => {
    await pressableByText(tree.root, "competitors.apply").props.onPress();
  });
  expect(applyCompetitorSuggestions).toHaveBeenCalledWith([{ productId: "p1", priceCents: 1000 }]);
});

it("a product with no links yet shows its numbers and an empty links section", async () => {
  jest.mocked(fetchCompetitorRows).mockResolvedValue([]);
  await render();
  const shown = texts();
  expect(shown).toContain("Chips");
  expect(shown).toContain("competitors.empty");
  expect(shown).toContain("competitors.addTitle");
  expect(shown).not.toContain("competitors.apply");
});

it("the product sheet link opens the edit screen", async () => {
  await render();
  await act(async () => pressableByText(tree.root, "competitors.viewProduct").props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/(app)/products/p1");
});
