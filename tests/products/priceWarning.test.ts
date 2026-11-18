import { priceWarning } from "../../src/lib/products/pricing";

describe("priceWarning", () => {
  it("warns about a zero price, with or without a known cost", () => {
    expect(priceWarning(0, null)).toEqual({ kind: "zero" });
    expect(priceWarning(0, 500)).toEqual({ kind: "zero" });
  });

  it("warns when the price is below the owner's cost", () => {
    expect(priceWarning(400, 500)).toEqual({
      kind: "below-cost",
      priceCents: 400,
      costCents: 500,
    });
  });

  it("does not warn at cost or above", () => {
    expect(priceWarning(500, 500)).toBeNull();
    expect(priceWarning(750, 500)).toBeNull();
  });

  it("does not compare when the cost is hidden (cashier) or unknown", () => {
    expect(priceWarning(100, null)).toBeNull();
    expect(priceWarning(100, 0)).toBeNull();
  });
});
