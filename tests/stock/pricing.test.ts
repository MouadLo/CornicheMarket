import { marginPercent, weightedAverageCost } from "../../src/lib/money";
import {
  isSignificantPriceChange,
  priceChangePercent,
  suggestSellingPrice,
} from "../../src/lib/stock/pricing";

// Pinned against a real delivery run through the apply_purchase_item trigger
// in Postgres: 48 @ 4.80 then 24 @ 6.00 gave stock 72 and cost 5.20.
describe("weighted average cost matches the database trigger", () => {
  it("blends an existing stock holding with a dearer delivery", () => {
    expect(weightedAverageCost(48, 480, 24, 600)).toBe(520);
  });
});

describe("priceChangePercent", () => {
  it("reports a rise", () => {
    expect(priceChangePercent(480, 600)).toBeCloseTo(25, 5);
  });

  it("reports a drop as negative", () => {
    expect(priceChangePercent(600, 480)).toBeCloseTo(-20, 5);
  });

  it("is zero when the price is unchanged", () => {
    expect(priceChangePercent(480, 480)).toBe(0);
  });

  it("returns null with no previous price to compare against", () => {
    expect(priceChangePercent(0, 480)).toBeNull();
  });
});

describe("isSignificantPriceChange", () => {
  it("flags a rise over 10%", () => {
    expect(isSignificantPriceChange(480, 600)).toBe(true);
  });

  it("flags a drop over 10%", () => {
    expect(isSignificantPriceChange(600, 480)).toBe(true);
  });

  it("stays quiet at exactly 10%", () => {
    expect(isSignificantPriceChange(1000, 1100)).toBe(false);
  });

  it("stays quiet just under the threshold", () => {
    expect(isSignificantPriceChange(1000, 1099)).toBe(false);
  });

  it("fires just over the threshold", () => {
    expect(isSignificantPriceChange(1000, 1101)).toBe(true);
  });

  it("stays quiet for a first-ever purchase", () => {
    expect(isSignificantPriceChange(0, 480)).toBe(false);
  });
});

describe("suggestSellingPrice", () => {
  it("keeps the previous margin when cost rises", () => {
    // Was: buy 4.80, sell 7.00 -> margin 31.43%
    // Now: buy 6.00 -> suggested 8.75, same margin
    const suggested = suggestSellingPrice(700, 480, 600);
    expect(suggested).toBe(875);

    const before = marginPercent(700, 480) as number;
    const after = marginPercent(suggested as number, 600) as number;
    expect(after).toBeCloseTo(before, 1);
  });

  it("keeps the previous margin when cost falls", () => {
    const suggested = suggestSellingPrice(700, 480, 400);
    const before = marginPercent(700, 480) as number;
    const after = marginPercent(suggested as number, 400) as number;
    expect(after).toBeCloseTo(before, 1);
  });

  it("leaves the price alone when cost is unchanged", () => {
    expect(suggestSellingPrice(700, 480, 480)).toBe(700);
  });

  it("rounds to whole centimes", () => {
    expect(Number.isInteger(suggestSellingPrice(777, 333, 521) as number)).toBe(true);
  });

  it("returns null without a previous cost to preserve a margin from", () => {
    expect(suggestSellingPrice(700, 0, 600)).toBeNull();
  });

  it("returns null when the product has no selling price", () => {
    expect(suggestSellingPrice(0, 480, 600)).toBeNull();
  });

  it("preserves margin even for a product sold at a loss", () => {
    const suggested = suggestSellingPrice(400, 480, 960) as number;
    expect(suggested).toBe(800);
    expect(marginPercent(suggested, 960)).toBeCloseTo(marginPercent(400, 480) as number, 1);
  });
});
