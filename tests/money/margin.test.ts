import {
  applyPercent,
  formatMAD,
  formatMargin,
  marginPercent,
  parseMoneyToCents,
  parseQuantity,
  profitCents,
} from "../../src/lib/money";

describe("per-unit profit shown on the product row", () => {
  it("is selling price minus buying price", () => {
    expect(profitCents(700, 480, 1)).toBe(220);
    expect(formatMAD(profitCents(700, 480, 1))).toBe("2.20 DH");
  });

  it("formats a loss with a minus sign", () => {
    expect(formatMAD(profitCents(400, 480, 1))).toBe("-0.80 DH");
  });

  it("formats the absolute loss the edit form displays", () => {
    expect(formatMAD(Math.abs(profitCents(400, 480, 1)))).toBe("0.80 DH");
  });
});

describe("marginPercent", () => {
  it("computes gross margin on the selling price", () => {
    // bought at 4.80, sells at 7.00 -> (700-480)/700 = 31.43%
    expect(marginPercent(700, 480)).toBeCloseTo(31.428, 2);
  });

  it("is negative when selling below cost", () => {
    expect(marginPercent(400, 480)).toBeLessThan(0);
  });

  it("is zero when selling exactly at cost", () => {
    expect(marginPercent(500, 500)).toBe(0);
  });

  it("returns null when the product has no cost yet", () => {
    expect(marginPercent(700, 0)).toBeNull();
  });

  it("returns null for a zero selling price", () => {
    expect(marginPercent(0, 480)).toBeNull();
  });
});

describe("formatMargin", () => {
  it("renders a dash for unknown margin", () => {
    expect(formatMargin(null)).toBe("—");
  });

  it("renders one decimal place", () => {
    expect(formatMargin(31.428)).toBe("31.4%");
  });
});

describe("applyPercent", () => {
  it("raises a price by a percentage", () => {
    expect(applyPercent(1000, 10)).toBe(1100);
  });

  it("lowers a price by a percentage", () => {
    expect(applyPercent(1000, -10)).toBe(900);
  });

  it("rounds to the nearest centime", () => {
    // 777 * 1.05 = 815.85 -> 816
    expect(applyPercent(777, 5)).toBe(816);
  });

  it("never goes below zero", () => {
    expect(applyPercent(1000, -150)).toBe(0);
  });

  it("leaves the price alone at 0%", () => {
    expect(applyPercent(1234, 0)).toBe(1234);
  });
});

describe("parseMoneyToCents", () => {
  it("parses a plain decimal", () => {
    expect(parseMoneyToCents("12.50")).toBe(1250);
  });

  it("parses a French decimal comma", () => {
    expect(parseMoneyToCents("12,50")).toBe(1250);
  });

  it("parses a whole number", () => {
    expect(parseMoneyToCents("7")).toBe(700);
  });

  it("handles thousands separators in both conventions", () => {
    expect(parseMoneyToCents("1 234,56")).toBe(123456);
    expect(parseMoneyToCents("1,234.56")).toBe(123456);
  });

  it("strips a currency suffix", () => {
    expect(parseMoneyToCents("12.50 DH")).toBe(1250);
  });

  it("rejects junk", () => {
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("")).toBeNull();
  });

  it("rejects negative money", () => {
    expect(parseMoneyToCents("-5")).toBeNull();
  });
});

describe("parseQuantity", () => {
  it("supports fractional kg", () => {
    expect(parseQuantity("1.5")).toBe(1.5);
    expect(parseQuantity("2,25")).toBe(2.25);
  });

  it("rejects junk", () => {
    expect(parseQuantity("x")).toBeNull();
  });
});
