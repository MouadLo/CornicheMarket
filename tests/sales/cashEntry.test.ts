import { filterCustomers, findCustomerByName, pressCashKey } from "../../src/lib/sales/cashEntry";
import type { WeightKey } from "../../src/lib/sales/weightEntry";

const type = (keys: string, start = "") =>
  [...keys].reduce((entry, key) => pressCashKey(entry, key as WeightKey), start);

describe("pressCashKey", () => {
  it("types digits and a decimal point", () => {
    expect(type("125.5")).toBe("125.5");
  });
  it("starts a leading point as 0.", () => {
    expect(type(".5")).toBe("0.5");
  });
  it("replaces a lone zero and ignores a second point", () => {
    expect(type("07")).toBe("7");
    expect(type("1.2.3")).toBe("1.23");
  });
  it("stops at two decimals and five integer digits", () => {
    expect(type("1.999")).toBe("1.99");
    expect(type("1234567")).toBe("12345");
  });
  it("backspace removes the last key, and nothing from empty", () => {
    expect(pressCashKey("12.5", "back")).toBe("12.");
    expect(pressCashKey("", "back")).toBe("");
  });
});

describe("filterCustomers", () => {
  const list = [{ name: "Amrani Youssef" }, { name: "Youssef Amrani" }, { name: "Nadia" }];
  it("shows everyone for an empty search", () => {
    expect(filterCustomers(list, "  ")).toEqual(list);
  });
  it("puts names that start with the text first", () => {
    expect(filterCustomers(list, "youssef").map((c) => c.name)).toEqual([
      "Youssef Amrani",
      "Amrani Youssef",
    ]);
  });
  it("shows nothing when no name matches", () => {
    expect(filterCustomers(list, "zzz")).toEqual([]);
  });
});

describe("findCustomerByName", () => {
  const list = [{ id: "1", name: "Fatima Zahra" }];
  it("ignores case and extra spaces", () => {
    expect(findCustomerByName(list, "  fatima   ZAHRA ")?.id).toBe("1");
  });
  it("does not match a different or empty name", () => {
    expect(findCustomerByName(list, "Fatima")).toBeNull();
    expect(findCustomerByName(list, " ")).toBeNull();
  });
});
