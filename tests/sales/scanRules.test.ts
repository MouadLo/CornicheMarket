import { DUPLICATE_WINDOW_MS, shouldAcceptScan } from "../../src/lib/sales/scanRules";

describe("shouldAcceptScan: ignore the same code twice within 1 second", () => {
  const last = { code: "6111234567890", at: 10_000 };

  it("the window is 1 second", () => {
    expect(DUPLICATE_WINDOW_MS).toBe(1000);
  });

  it("accepts the first scan", () => {
    expect(shouldAcceptScan(null, "6111234567890", 10_000)).toBe(true);
  });

  it("ignores the same code at 0 ms and at 999 ms", () => {
    expect(shouldAcceptScan(last, "6111234567890", 10_000)).toBe(false);
    expect(shouldAcceptScan(last, "6111234567890", 10_999)).toBe(false);
  });

  it("accepts the same code again at exactly 1000 ms (a second identical item)", () => {
    expect(shouldAcceptScan(last, "6111234567890", 11_000)).toBe(true);
    expect(shouldAcceptScan(last, "6111234567890", 15_000)).toBe(true);
  });

  it("accepts a different code immediately", () => {
    expect(shouldAcceptScan(last, "6119876543210", 10_001)).toBe(true);
  });
});
