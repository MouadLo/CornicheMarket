/**
 * Reports: the "Divers (estimé)" card (lines, revenue, estimated profit, share of
 * the period's revenue, a hint that the cost is estimated); left out when there
 * is no Divers; a failed read never hides the other reports.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ReportsScreen from "../../app/(app)/reports/index";
import { allTexts } from "../sales/sellTestUtils";

const mockFetchDivers = jest.fn();

jest.mock("expo-router", () => ({ router: { push: jest.fn() }, Redirect: () => null }));
jest.mock("react-i18next", () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key);
  const i18n = { language: "fr" };
  return { useTranslation: () => ({ t, i18n }) };
});
jest.mock("lucide-react-native", () => {
  const R = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => R.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "o", role: "owner" } }),
}));
jest.mock("../../src/lib/reports/export", () => ({
  exportTablesAsCsv: jest.fn(),
  exportTablesAsPdf: jest.fn(),
}));
jest.mock("../../src/lib/loyalty/queries", () => ({
  fetchLoyaltyReport: async () => null,
}));
jest.mock("../../src/lib/reports/queries", () => ({
  fetchStoreTimezone: async () => "UTC",
  fetchSummary: async () => ({
    revenue_cents: 10000,
    cogs_cents: 3000,
    gross_profit_cents: 2000,
    margin_percent: 40,
    transaction_count: 4,
    average_basket_cents: 1250,
    loss_cents: 0,
    returns_cents: 0,
  }),
  fetchDailyTrend: async () => [],
  fetchByCategory: async () => [],
  fetchByHour: async () => [],
  fetchProductPerformance: async () => [],
  fetchDeadStock: async () => [],
  fetchInventoryValue: async () => null,
  fetchDiversReport: (...a: unknown[]) => mockFetchDivers(...a),
}));

const divers = {
  lineCount: 3,
  returnedCount: 0,
  revenueCents: 1200,
  costCents: 960,
  profitCents: 240,
};

const NOW = new Date("2026-01-15T10:00:00.000Z");
let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<ReportsScreen />);
  });
};
const texts = () => allTexts(tree.root);

beforeEach(() => {
  jest
    .useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] })
    .setSystemTime(NOW);
  mockFetchDivers.mockReset();
  mockFetchDivers.mockResolvedValue(divers);
});
afterEach(() => {
  act(() => tree.unmount());
  jest.useRealTimers();
});

it("asks for the selected range together with the other reports", async () => {
  await render();
  expect(mockFetchDivers).toHaveBeenCalled();
  const [from, to] = mockFetchDivers.mock.calls[mockFetchDivers.mock.calls.length - 1];
  expect(from).toBeInstanceOf(Date);
  expect(to.getTime()).toBeGreaterThan(from.getTime());
});

it("shows lines, revenue, estimated profit, the share of revenue and the estimate hint", async () => {
  await render();
  const all = texts();
  expect(all).toContain("reports.diversTitle");
  expect(all).toContain("3");
  expect(all).toContain("12.00 DH");
  expect(all).toContain("2.40 DH");
  expect(all.some((x) => x.startsWith("reports.diversShare") && x.includes("12 %"))).toBe(true);
  expect(all).toContain("reports.diversHint");
});

it("is left out when there is no Divers in the period", async () => {
  mockFetchDivers.mockResolvedValue({
    ...divers,
    lineCount: 0,
    revenueCents: 0,
    profitCents: 0,
    costCents: 0,
  });
  await render();
  expect(texts()).not.toContain("reports.diversTitle");
  expect(texts()).toContain("reports.metricRevenue");
});

it("a failed Divers read leaves its card out and keeps the other reports", async () => {
  mockFetchDivers.mockRejectedValue(new Error("boom"));
  await render();
  expect(texts()).not.toContain("reports.diversTitle");
  expect(texts()).toContain("reports.metricRevenue");
});
