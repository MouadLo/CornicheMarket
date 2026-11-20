/**
 * Settings > Fidélité (owner): the switch and rates, validation messages, the
 * save, and the excluded-categories list (sub-categories under their main one).
 */
import React from "react";
import { Switch, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import Settings from "../../app/(app)/settings";
import { LoyaltySection } from "../../src/components/settings/LoyaltySection";
import { allTexts } from "../sales/sellTestUtils";

const mockFetchSettings = jest.fn();
const mockFetchCategories = jest.fn();
const mockUpdate = jest.fn(async (..._a: unknown[]) => {});
const mockSetExcluded = jest.fn(async (..._a: unknown[]) => {});
let mockRole = "owner";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: object) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("../../src/lib/loyalty/queries", () => ({
  fetchLoyaltySettings: () => mockFetchSettings(),
  fetchLoyaltyCategories: () => mockFetchCategories(),
  updateLoyaltySettings: (...a: unknown[]) => mockUpdate(...a),
  setCategoryLoyaltyExcluded: (...a: unknown[]) => mockSetExcluded(...a),
}));
jest.mock("lucide-react-native", () => {
  const R = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => R.createElement("Icon", { name, ...p }) }
  );
});
// The rest of the Settings screen is not under test here.
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    session: { user: { id: "me", email: "o@x.ma" } },
    profile: { full_name: "Salma", role: mockRole },
  }),
}));
jest.mock("../../src/lib/auth/useSignOut", () => ({ useSignOut: () => jest.fn() }));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/i18n", () => ({ changeLanguage: jest.fn() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../../src/lib/backup/export", () => ({
  exportEverything: jest.fn(),
  exportProducts: jest.fn(),
  exportPurchases: jest.fn(),
  exportSales: jest.fn(),
  getLastBackupTime: jest.fn(async () => new Date()),
}));
jest.mock("../../src/lib/reports/queries", () => ({
  fetchStoreTimezone: jest.fn(async () => "UTC"),
  updateStoreTimezone: jest.fn(),
}));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchDiscountLimits: async () => ({ percent: 5, maxCents: 2000 }),
  updateDiscountLimits: jest.fn(),
  fetchStoreCreditLimit: async () => 30000,
  updateStoreCreditLimit: jest.fn(),
}));
jest.mock("../../src/lib/auth/inviteCashier", () => ({ inviteCashier: jest.fn() }));
jest.mock("../../src/lib/auth/staff", () => ({
  ...jest.requireActual("../../src/lib/auth/staff"),
  fetchStaff: async () => [],
}));
jest.mock("../../src/lib/dialog/store", () => ({ confirm: jest.fn() }));

const settings = {
  enabled: false,
  centsPerPoint: 1000,
  pointValueCents: 10,
  minRedeemPoints: 100,
  dailyReviewPoints: 100,
  welcomePoints: 0,
};
const categories = [
  { id: "b", name: "Boissons", code: null, parent_id: null, loyalty_excluded: false },
  { id: "b1", name: "Eaux", code: null, parent_id: "b", loyalty_excluded: false },
  { id: "t", name: "Tabac", code: null, parent_id: null, loyalty_excluded: true },
  { id: "t1", name: "Cigares", code: null, parent_id: "t", loyalty_excluded: false },
];

let tree: ReactTestRenderer;
const render = async (el: React.ReactElement = <LoyaltySection />) => {
  await act(async () => {
    tree = create(el);
  });
};
const field = (label: string) =>
  tree.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
const save = () =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === "loyalty.settingsSave")!;
const toggle = (label: string) =>
  tree.root.findAllByType(Switch).find((n) => n.props.accessibilityLabel === label)!;

beforeEach(() => {
  mockRole = "owner";
  [mockFetchSettings, mockFetchCategories, mockUpdate, mockSetExcluded].forEach((m) =>
    m.mockClear()
  );
  mockFetchSettings.mockResolvedValue(settings);
  mockFetchCategories.mockResolvedValue(categories);
});
afterEach(() => act(() => tree.unmount()));

it("shows the saved rates the way the owner reads them", async () => {
  await render();
  expect(field("loyalty.settingsEarnLabel").props.value).toBe("10.00");
  expect(field("loyalty.settingsValueLabel").props.value).toBe("10.00");
  expect(field("loyalty.settingsMinPoints").props.value).toBe("100");
  expect(field("loyalty.settingsDailyPoints").props.value).toBe("100");
  expect(field("loyalty.settingsWelcomePoints").props.value).toBe("0");
  expect(toggle("loyalty.settingsEnable").props.value).toBe(false);
  expect(allTexts(tree.root).join("|")).toContain("loyalty.settingsBackPercent");
});

it("refuses 100 points that are not a whole number of centimes per point, and saves nothing", async () => {
  await render();
  act(() => field("loyalty.settingsValueLabel").props.onChangeText("10.50"));
  await act(async () => save().props.onPress());
  expect(allTexts(tree.root)).toContain("loyalty.errPointValueFraction");
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("shows one message per wrong field", async () => {
  await render();
  act(() => field("loyalty.settingsEarnLabel").props.onChangeText("0"));
  act(() => field("loyalty.settingsMinPoints").props.onChangeText("x"));
  await act(async () => save().props.onPress());
  const texts = allTexts(tree.root);
  expect(texts).toContain("loyalty.errRatePerPoint");
  expect(texts).toContain("loyalty.errMinPoints");
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("saves the switch and the rates in centimes", async () => {
  await render();
  act(() => toggle("loyalty.settingsEnable").props.onValueChange(true));
  act(() => field("loyalty.settingsEarnLabel").props.onChangeText("5"));
  act(() => field("loyalty.settingsValueLabel").props.onChangeText("12"));
  act(() => field("loyalty.settingsWelcomePoints").props.onChangeText("20"));
  await act(async () => save().props.onPress());
  expect(mockUpdate).toHaveBeenCalledWith({
    enabled: true,
    centsPerPoint: 500,
    pointValueCents: 12,
    minRedeemPoints: 100,
    dailyReviewPoints: 100,
    welcomePoints: 20,
  });
  expect(allTexts(tree.root)).toContain("loyalty.settingsSaved");
});

it("a failed save is explained and keeps the values", async () => {
  mockUpdate.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await render();
  await act(async () => save().props.onPress());
  expect(allTexts(tree.root).join("|")).toContain("errors.network");
  expect(field("loyalty.settingsEarnLabel").props.value).toBe("10.00");
});

it("lists categories with sub-categories under their main one, excluded ones switched on", async () => {
  await render();
  const names = allTexts(tree.root).filter((x) => /Boissons|Eaux|Tabac|Cigares/.test(x));
  expect(names.map((x) => x.replace(/[⁨⁩]/g, ""))).toEqual([
    "Boissons",
    "Eaux",
    "Tabac",
    "Cigares",
  ]);
  expect(toggle("loyalty.excluded ⁨Tabac⁩").props.value).toBe(true);
  expect(toggle("loyalty.excluded ⁨Boissons⁩").props.value).toBe(false);
  // A sub-category of an excluded main category is excluded with it.
  const inherited = toggle("loyalty.excluded ⁨Cigares⁩");
  expect(inherited.props.value).toBe(true);
  expect(inherited.props.disabled).toBe(true);
  expect(allTexts(tree.root)).toContain("loyalty.settingsInherited");
});

it("a category toggle is saved at once, and put back when it fails", async () => {
  await render();
  await act(async () => toggle("loyalty.excluded ⁨Eaux⁩").props.onValueChange(true));
  expect(mockSetExcluded).toHaveBeenCalledWith("b1", true);
  expect(toggle("loyalty.excluded ⁨Eaux⁩").props.value).toBe(true);

  mockSetExcluded.mockRejectedValueOnce(new Error("permission denied"));
  await act(async () => toggle("loyalty.excluded ⁨Boissons⁩").props.onValueChange(true));
  expect(toggle("loyalty.excluded ⁨Boissons⁩").props.value).toBe(false);
  expect(allTexts(tree.root).join("|")).toContain("errors.permission");
});

it("a failed read shows Retry instead of default values", async () => {
  mockFetchSettings.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await render();
  expect(allTexts(tree.root)).toContain("loyalty.settingsLoadError");
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});

it("the Settings screen shows the section to the owner only", async () => {
  await render(<Settings />);
  expect(allTexts(tree.root)).toContain("loyalty.settingsTitle");
  act(() => tree.unmount());
  mockRole = "cashier";
  await render(<Settings />);
  expect(allTexts(tree.root)).not.toContain("loyalty.settingsTitle");
  expect(mockFetchSettings).toHaveBeenCalledTimes(1);
});
