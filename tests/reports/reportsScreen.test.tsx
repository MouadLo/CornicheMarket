/**
 * Reports screen: a one-day range shows the hourly chart once and no daily
 * chart; Revenue and Transactions open the sales history on the report's range.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ReportsScreen from "../../app/(app)/reports/index";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const t = (key: string) => key; // stable: the screen uses t in hook deps
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
jest.mock("../../src/lib/reports/queries", () => {
  const summary = {
    revenue_cents: 5000,
    cogs_cents: 3000,
    gross_profit_cents: 2000,
    margin_percent: 40,
    transaction_count: 4,
    average_basket_cents: 1250,
    loss_cents: 0,
  };
  return {
    fetchStoreTimezone: async () => "UTC",
    fetchSummary: async () => summary,
    fetchDailyTrend: async () => [{ day: "2026-01-15", revenue_cents: 5000, profit_cents: 2000 }],
    fetchByCategory: async () => [
      {
        category_id: "c",
        category_name: "Produits laitiers et fromages",
        revenue_cents: 5000,
        profit_cents: 2000,
      },
    ],
    fetchByHour: async () => [{ hour: 10, revenue_cents: 5000, transaction_count: 4 }],
    fetchProductPerformance: async () => [],
    fetchDeadStock: async () => [],
    fetchInventoryValue: async () => null,
  };
});

const NOW = new Date("2026-01-15T10:00:00.000Z");
let tree: ReactTestRenderer;

const texts = () =>
  tree.root.findAllByType(Text).map((n) => [n.props.children].flat(Infinity).join(""));
const render = async () => {
  await act(async () => {
    tree = create(<ReportsScreen />);
  });
};
const chip = (label: string) =>
  tree.root.find(
    (n) =>
      n.props.accessibilityRole === "button" &&
      n.props.onPress &&
      texts().length > 0 &&
      n.findAllByType(Text).some((x) => x.props.children === label)
  );

beforeEach(() => {
  jest
    .useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] })
    .setSystemTime(NOW);
  mockPush.mockReset();
});
afterEach(() => {
  act(() => tree.unmount());
  jest.useRealTimers();
});

describe("reports screen", () => {
  it("shows the hourly chart once, and no daily chart, for Today", async () => {
    await render();
    const all = texts();
    expect(all.filter((x) => x === "reports.byHour")).toHaveLength(1);
    expect(all).not.toContain("reports.dailySales");
    expect(all).toContain("10h");
  });

  it("keeps the daily chart and the hourly chart for a longer range", async () => {
    await render();
    await act(async () => chip("reports.last7days").props.onPress());
    const all = texts();
    expect(all.filter((x) => x === "reports.byHour")).toHaveLength(1);
    expect(all).toContain("reports.dailySales");
  });

  it("shows the whole category name", async () => {
    await render();
    expect(texts().join("|")).toContain("Produits laitiers et fromages");
  });

  it("opens the sales history on the report's range from Revenue", async () => {
    await render();
    const revenue = tree.root.find(
      (n) =>
        typeof n.props.onPress === "function" &&
        n.props.accessibilityLabel?.startsWith("reports.metricRevenue")
    );
    act(() => revenue.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/sell/history",
      params: { rangeFrom: "2026-01-15T00:00:00.000Z", rangeTo: "2026-01-16T00:00:00.000Z" },
    });
  });
});
