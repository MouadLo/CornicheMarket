/**
 * Reports: the Fidélité card (value of points spent in DH, points earned and
 * bonus, new/total members, member share, top members, top bonus products only
 * when there are some), and a failed loyalty read never hides the other reports.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ReportsScreen from "../../app/(app)/reports/index";
import { allTexts } from "../sales/sellTestUtils";

const mockFetchLoyalty = jest.fn();

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
  fetchLoyaltyReport: (...a: unknown[]) => mockFetchLoyalty(...a),
}));
jest.mock("../../src/lib/reports/queries", () => ({
  fetchStoreTimezone: async () => "UTC",
  fetchSummary: async () => ({
    revenue_cents: 5000,
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
}));

const report = {
  pointsEarned: 500,
  pointsBonus: 40,
  pointsAdjusted: 0,
  pointsRedeemed: 100,
  valueRedeemedCents: 1000,
  membersTotal: 30,
  membersNew: 4,
  memberSalesCount: 12,
  memberSalesCents: 25000,
  allSalesCents: 100000,
  topMembers: [{ name: "Sara", salesCents: 9000, pointsBalance: 90 }],
  topBonusProducts: [{ productName: "Lait Centrale", bonusPoints: 40 }],
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
  mockFetchLoyalty.mockReset();
  mockFetchLoyalty.mockResolvedValue(report);
});
afterEach(() => {
  act(() => tree.unmount());
  jest.useRealTimers();
});

it("asks for the selected range together with the other reports", async () => {
  await render();
  // (the screen loads again once the store's time zone arrives, like the others)
  expect(mockFetchLoyalty).toHaveBeenCalled();
  const [from, to] = mockFetchLoyalty.mock.calls[mockFetchLoyalty.mock.calls.length - 1];
  expect(from).toBeInstanceOf(Date);
  expect(to.getTime()).toBeGreaterThan(from.getTime());
});

it("shows the value spent in DH, points earned and bonus, members and the member share", async () => {
  await render();
  const all = texts();
  expect(all).toContain("loyalty.reportTitle");
  expect(all).toContain("10.00 DH");
  expect(all.some((x) => x.startsWith("loyalty.pointsMany") && x.includes("500"))).toBe(true);
  expect(all.some((x) => x.startsWith("loyalty.pointsMany") && x.includes("40"))).toBe(true);
  expect(all).toContain("⁦4 / 30⁩");
  expect(all).toContain("⁦25%⁩");
});

it("lists top members and top bonus products", async () => {
  await render();
  expect(texts().join("|")).toContain("Sara");
  expect(texts()).toContain("loyalty.reportTopBonus");
  expect(texts().join("|")).toContain("Lait Centrale");
});

it("leaves the bonus list out when no bonus was given", async () => {
  mockFetchLoyalty.mockResolvedValue({ ...report, topBonusProducts: [], pointsBonus: 0 });
  await render();
  expect(texts()).not.toContain("loyalty.reportTopBonus");
});

it("says there are no member sales instead of an empty table", async () => {
  mockFetchLoyalty.mockResolvedValue({ ...report, topMembers: [], allSalesCents: 0 });
  await render();
  expect(texts()).toContain("loyalty.reportNoMembers");
  expect(texts()).toContain("—");
});

it("a failed loyalty read leaves its card out and keeps the other reports", async () => {
  mockFetchLoyalty.mockRejectedValue(new Error("boom"));
  await render();
  expect(texts()).not.toContain("loyalty.reportTitle");
  expect(texts()).toContain("reports.metricRevenue");
});
