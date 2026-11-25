import { checkSitePriceMargin, minMarginBpFor } from "../../src/lib/webstore/priceMargin";

const check = (newPriceCents: number, costCents: number | null, minMarginBp = 1500) =>
  checkSitePriceMargin({ newPriceCents, costCents, minMarginBp });

describe("checkSitePriceMargin", () => {
  it("ok: 9.00 on a 7.00 cost is a 22 % margin", () => {
    expect(check(900, 700)).toEqual({ level: "ok", marginBp: 2222, minPriceCents: 850 });
  });

  it("low: below the minimum, with the advised minimum price (rounded up to 0.50)", () => {
    // cost 7.20, 15 % -> 8.4705 -> 8.50 ; 8.00 gives 10 %
    expect(check(800, 720)).toEqual({ level: "low", marginBp: 1000, minPriceCents: 850 });
  });

  it("exactly at the minimum margin is ok", () => {
    // (1000 - 850) / 1000 = 15 % exactly
    expect(check(1000, 850).level).toBe("ok");
    expect(check(999, 850).level).toBe("low");
  });

  it("the boundary uses exact math, not the rounded margin", () => {
    // 14.996 % rounds to 1500 bp but is below 15 %
    expect(check(50_000, 42_502).marginBp).toBe(1500);
    expect(check(50_000, 42_502).level).toBe("low");
  });

  it("a product's own 5 % minimum", () => {
    expect(check(800, 720, 500).level).toBe("ok"); // 10 %
    expect(check(750, 720, 500).level).toBe("low"); // 4 %
  });

  it("loss: price at or below the cost", () => {
    expect(check(720, 720).level).toBe("loss");
    expect(check(500, 720)).toEqual({ level: "loss", marginBp: -4400, minPriceCents: 850 });
  });

  it("unknown: cost null or 0 never blocks and gives no numbers", () => {
    const unknown = { level: "unknown", marginBp: null, minPriceCents: null };
    expect(check(900, null)).toEqual(unknown);
    expect(check(900, 0)).toEqual(unknown);
  });
});

describe("minMarginBpFor", () => {
  it("uses the product override, else the store margin", () => {
    expect(minMarginBpFor(5, 15)).toBe(500);
    expect(minMarginBpFor(null, 15)).toBe(1500);
    expect(minMarginBpFor(null, 12.5)).toBe(1250);
    expect(minMarginBpFor(0, 15)).toBe(0);
  });
});
