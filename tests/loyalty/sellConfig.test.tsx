import React from "react";
import { act, create } from "react-test-renderer";

import {
  loadCachedLoyaltyConfig,
  parseLoyaltyConfig,
  saveCachedLoyaltyConfig,
  useLoyaltyConfig,
  type SellLoyaltyConfig,
} from "../../src/lib/loyalty/sellConfig";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

const mockSettings = jest.fn();
const mockCategories = jest.fn();
jest.mock("../../src/lib/loyalty/queries", () => ({
  fetchLoyaltySettings: () => mockSettings(),
  fetchLoyaltyCategories: () => mockCategories(),
}));

const on = {
  enabled: true,
  centsPerPoint: 2000,
  pointValueCents: 20,
  minRedeemPoints: 50,
  dailyReviewPoints: 100,
  welcomePoints: 0,
};

let seen: SellLoyaltyConfig;
function Probe({ online }: { online: boolean }) {
  seen = useLoyaltyConfig(online);
  return null;
}
async function render(online: boolean) {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Probe online={online} />);
  });
  return tree;
}

beforeEach(async () => {
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.clear();
  mockSettings.mockReset();
  mockCategories.mockReset();
});

describe("the loyalty configuration of the counter", () => {
  it("is off until the device has heard otherwise", async () => {
    mockSettings.mockRejectedValue(new Error("offline"));
    const tree = await render(true);
    expect(seen.enabled).toBe(false);
    expect(seen.rates).toEqual({ centsPerPoint: 1000, pointValueCents: 10, minRedeemPoints: 100 });
    act(() => tree.unmount());
  });

  it("online: reads the switch, the rates and the excluded categories (and their children), and keeps them", async () => {
    mockSettings.mockResolvedValue(on);
    mockCategories.mockResolvedValue([
      { id: "tobacco", name: "T", code: null, parent_id: null, loyalty_excluded: true },
      { id: "cigars", name: "C", code: null, parent_id: "tobacco", loyalty_excluded: false },
      { id: "dairy", name: "D", code: null, parent_id: null, loyalty_excluded: false },
    ]);
    const tree = await render(true);
    expect(seen.enabled).toBe(true);
    expect(seen.rates).toEqual({ centsPerPoint: 2000, pointValueCents: 20, minRedeemPoints: 50 });
    expect([...seen.excludedCategories].sort()).toEqual(["cigars", "tobacco"]);
    expect((await loadCachedLoyaltyConfig())?.excludedCategoryIds.sort()).toEqual([
      "cigars",
      "tobacco",
    ]);
    act(() => tree.unmount());
  });

  it("offline: the last answer is used", async () => {
    await saveCachedLoyaltyConfig({ settings: on, excludedCategoryIds: ["tobacco"] });
    const tree = await render(false);
    expect(seen.enabled).toBe(true);
    expect(seen.rates.minRedeemPoints).toBe(50);
    expect(seen.excludedCategories.has("tobacco")).toBe(true);
    expect(mockSettings).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("a failed category read keeps the switch and the rates, and the last exclusions", async () => {
    await saveCachedLoyaltyConfig({ settings: on, excludedCategoryIds: ["tobacco"] });
    mockSettings.mockResolvedValue({ ...on, minRedeemPoints: 70 });
    mockCategories.mockRejectedValue(new Error("denied"));
    const tree = await render(true);
    expect(seen.rates.minRedeemPoints).toBe(70);
    expect(seen.excludedCategories.has("tobacco")).toBe(true);
    act(() => tree.unmount());
  });

  it("switched off by the owner: off at once", async () => {
    await saveCachedLoyaltyConfig({ settings: on, excludedCategoryIds: [] });
    mockSettings.mockResolvedValue({ ...on, enabled: false });
    const tree = await render(true);
    expect(seen.enabled).toBe(false);
    act(() => tree.unmount());
  });

  it("ignores a cached value that makes no sense", () => {
    expect(parseLoyaltyConfig(null)).toBeNull();
    expect(parseLoyaltyConfig({})).toBeNull();
    expect(
      parseLoyaltyConfig({
        settings: { enabled: true, centsPerPoint: -5 },
        excludedCategoryIds: [1],
      })
    ).toEqual({
      settings: expect.objectContaining({ enabled: true, centsPerPoint: 1000 }),
      excludedCategoryIds: [],
    });
  });
});
