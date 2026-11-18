import {
  badgeFromCount,
  badgeFromSettled,
  gridColumns,
  EXPIRING_DEFAULT_DAYS,
} from "../../src/lib/inventory/stockHome";

describe("stock home badges", () => {
  it("a failed load shows no badge, never a false zero", () => {
    expect(badgeFromSettled({ status: "rejected", reason: new Error("x") })).toEqual({
      kind: "unknown",
    });
    expect(badgeFromCount(undefined)).toEqual({ kind: "unknown" });
    expect(badgeFromCount(NaN)).toEqual({ kind: "unknown" });
  });

  it("zero is a calm state and a positive count carries the number", () => {
    expect(badgeFromSettled({ status: "fulfilled", value: 0 })).toEqual({ kind: "zero" });
    expect(badgeFromSettled({ status: "fulfilled", value: 4 })).toEqual({ kind: "some", count: 4 });
  });

  it("uses the same window as the Expiring screen's default", () => {
    expect(EXPIRING_DEFAULT_DAYS).toBe(30);
  });

  it("picks one column on a phone and a grid on wider screens", () => {
    expect(gridColumns(360)).toBe(1);
    expect(gridColumns(768)).toBe(2);
    expect(gridColumns(1200)).toBe(3);
  });
});
