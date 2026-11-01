import {
  centsToDisplay,
  displayToCents,
  formatMAD,
  formatMADGrouped,
  lineTotalCents,
  profitCents,
  weightedAverageCost,
} from "../../src/lib/money";

describe("centsToDisplay / displayToCents", () => {
  it("round-trips a typical price", () => {
    expect(centsToDisplay(1250)).toBe("12.50");
    expect(displayToCents("12.50")).toBe(1250);
  });

  it("handles zero", () => {
    expect(centsToDisplay(0)).toBe("0.00");
    expect(displayToCents("0")).toBe(0);
  });
});

describe("formatMAD", () => {
  it("appends the currency suffix", () => {
    expect(formatMAD(700)).toBe("7.00 DH");
  });
});

describe("weightedAverageCost", () => {
  it("returns the new cost when there was no prior stock", () => {
    expect(weightedAverageCost(0, 0, 48, 480)).toBe(480);
  });

  it("averages old and new stock proportionally", () => {
    // 10 units @ 100, buying 10 units @ 200 -> average 150
    expect(weightedAverageCost(10, 100, 10, 200)).toBe(150);
  });

  it("weights toward the larger quantity", () => {
    // 90 units @ 100, buying 10 units @ 200 -> (9000 + 2000) / 100 = 110
    expect(weightedAverageCost(90, 100, 10, 200)).toBe(110);
  });

  it("rounds to the nearest centime", () => {
    // (10*100 + 3*133) / 13 = 1399/13 = 107.6153... -> 108
    expect(weightedAverageCost(10, 100, 3, 133)).toBe(108);
  });
});

describe("lineTotalCents", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineTotalCents(3, 700)).toBe(2100);
  });

  it("supports fractional quantities (kg)", () => {
    expect(lineTotalCents(1.5, 600)).toBe(900);
  });

  it("subtracts a discount", () => {
    expect(lineTotalCents(3, 700, 200)).toBe(1900);
  });
});

describe("profitCents", () => {
  it("computes margin per line", () => {
    expect(profitCents(700, 480, 1)).toBe(220);
  });

  it("scales with quantity", () => {
    expect(profitCents(700, 480, 3)).toBe(660);
  });

  it("can be negative when sold below cost", () => {
    expect(profitCents(400, 480, 1)).toBe(-80);
  });
});

describe("formatMADGrouped", () => {
  it("groups thousands with a narrow no-break space", () => {
    expect(formatMADGrouped(348250)).toBe("3\u202f482.50 DH");
    expect(formatMADGrouped(100000000)).toBe("1\u202f000\u202f000.00 DH");
  });
  it("leaves small amounts alone and keeps centimes", () => {
    expect(formatMADGrouped(0)).toBe("0.00 DH");
    expect(formatMADGrouped(5)).toBe("0.05 DH");
    expect(formatMADGrouped(99999)).toBe("999.99 DH");
    expect(formatMADGrouped(100000)).toBe("1\u202f000.00 DH");
  });
  it("uses a real minus sign for negatives", () => {
    expect(formatMADGrouped(-186000)).toBe("\u22121\u202f860.00 DH");
  });
  it("agrees with formatMAD once spaces are removed", () => {
    for (const c of [0, 7, 1250, 123456, -4321, 99999999]) {
      expect(
        formatMADGrouped(c)
          .replace(/\u202f/g, "")
          .replace("\u2212", "-")
      ).toBe(formatMAD(c));
    }
  });
});
