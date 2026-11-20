import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  loadCachedCustomers,
  loadCachedStoreCreditLimit,
  parseCachedCustomers,
  parseCreditLimitCents,
  saveCachedCustomers,
  saveCachedStoreCreditLimit,
} from "../../src/lib/sales/creditLimitCache";

beforeEach(() => AsyncStorage.clear());

describe("parseCreditLimitCents", () => {
  it("accepts whole non-negative centimes, as numbers or numeric strings", () => {
    expect(parseCreditLimitCents(30000)).toBe(30000);
    expect(parseCreditLimitCents("5000")).toBe(5000);
    expect(parseCreditLimitCents(0)).toBe(0);
  });
  it("rejects anything unusable", () => {
    expect(parseCreditLimitCents(null)).toBeNull();
    expect(parseCreditLimitCents(undefined)).toBeNull();
    expect(parseCreditLimitCents(-1)).toBeNull();
    expect(parseCreditLimitCents(12.5)).toBeNull();
    expect(parseCreditLimitCents("abc")).toBeNull();
  });
});

describe("the offline copy of the store default", () => {
  it("is empty on a device that never read it", async () => {
    expect(await loadCachedStoreCreditLimit()).toBeNull();
  });
  it("returns the last value saved, including 0", async () => {
    await saveCachedStoreCreditLimit(45000);
    expect(await loadCachedStoreCreditLimit()).toBe(45000);
    await saveCachedStoreCreditLimit(0);
    expect(await loadCachedStoreCreditLimit()).toBe(0);
  });
  it("ignores a damaged copy", async () => {
    await AsyncStorage.setItem("corniche.creditLimit.v1", "{nope");
    expect(await loadCachedStoreCreditLimit()).toBeNull();
  });
});

describe("the offline copy of the customers", () => {
  it("keeps balance and effective limit, including a limit of 0", async () => {
    await saveCachedCustomers([
      { id: "a", name: "Fatima", phone: "06", balance_cents: 2500, credit_limit_cents: 30000 },
      { id: "b", name: "Omar", phone: null, balance_cents: 0, credit_limit_cents: 0 },
      { id: "c", name: "Sara", phone: null },
    ]);
    expect(await loadCachedCustomers()).toEqual([
      { id: "a", name: "Fatima", phone: "06", balance_cents: 2500, credit_limit_cents: 30000 },
      { id: "b", name: "Omar", phone: null, balance_cents: 0, credit_limit_cents: 0 },
      { id: "c", name: "Sara", phone: null },
    ]);
  });
  it("drops malformed rows and survives a damaged copy", async () => {
    expect(
      parseCachedCustomers([{ id: 1 }, null, { id: "a", name: "A", credit_limit_cents: -5 }])
    ).toEqual([{ id: "a", name: "A", phone: null }]);
    expect(parseCachedCustomers("nope")).toEqual([]);
    await AsyncStorage.setItem("corniche.creditCustomers.v1", "{nope");
    expect(await loadCachedCustomers()).toEqual([]);
  });
});
