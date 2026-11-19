import AsyncStorage from "@react-native-async-storage/async-storage";

import { DEFAULT_DISCOUNT_LIMITS } from "../../src/lib/sales/discountLimit";
import {
  loadCachedDiscountLimits,
  parseDiscountLimits,
  saveCachedDiscountLimits,
} from "../../src/lib/sales/discountLimitCache";

beforeEach(() => AsyncStorage.clear());

describe("parseDiscountLimits", () => {
  it("accepts numbers and numeric strings (numeric columns can arrive as text)", () => {
    expect(parseDiscountLimits(5, 2000)).toEqual({ percent: 5, maxCents: 2000 });
    expect(parseDiscountLimits("7.50", "1500")).toEqual({ percent: 7.5, maxCents: 1500 });
  });
  it("rejects anything unusable", () => {
    expect(parseDiscountLimits(null, 2000)).toBeNull();
    expect(parseDiscountLimits(5, 12.5)).toBeNull();
    expect(parseDiscountLimits(101, 2000)).toBeNull();
    expect(parseDiscountLimits(-1, 2000)).toBeNull();
    expect(parseDiscountLimits(5, -1)).toBeNull();
  });
});

describe("the offline copy", () => {
  it("is empty on a device that never read the limits (the defaults then apply)", async () => {
    expect(await loadCachedDiscountLimits()).toBeNull();
    expect(DEFAULT_DISCOUNT_LIMITS).toEqual({ percent: 5, maxCents: 2000 });
  });
  it("returns the last limits saved", async () => {
    await saveCachedDiscountLimits({ percent: 3, maxCents: 1000 });
    expect(await loadCachedDiscountLimits()).toEqual({ percent: 3, maxCents: 1000 });
  });
  it("ignores a damaged copy", async () => {
    await AsyncStorage.setItem("corniche.discountLimits.v1", "{nope");
    expect(await loadCachedDiscountLimits()).toBeNull();
  });
});
