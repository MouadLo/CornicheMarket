import {
  allocateSaleDiscount,
  averageBasketCents,
  grossMarginPercent,
  inventoryPotentialProfitCents,
  netLineRevenue,
} from "../../src/lib/reports/math";

// The worked example below was also run through the report SQL functions in
// Postgres, which returned exactly these figures. Both sides are asserted
// here so neither can drift silently.
//
//   Sale A: 2 Coca @ 7.00                          -> lines 14.00, no discount
//   Sale B: 3 Baguette @ 1.50 + 1 Lait @ 12.00     -> lines 16.50, 1.50 off
//   Sale C: 5 Coca, voided                         -> excluded entirely
//
//   revenue 29.00, cost of goods 21.50, gross profit 7.50, margin 25.86%,
//   2 transactions, average basket 14.50
describe("the worked example from the reports", () => {
  const COCA = { lineTotal: 1400, cost: 960 };
  const BAGUETTE = { lineTotal: 450, cost: 240 };
  const LAIT = { lineTotal: 1200, cost: 950 };

  it("splits a basket discount in proportion to line value", () => {
    // 1.50 across lines of 4.50 and 12.00
    expect(allocateSaleDiscount([BAGUETTE.lineTotal, LAIT.lineTotal], 150)).toEqual([41, 109]);
  });

  it("gives the net revenue the SQL reported per product", () => {
    expect(netLineRevenue([BAGUETTE.lineTotal, LAIT.lineTotal], 150)).toEqual([409, 1091]);
  });

  it("reconciles product revenue with the headline revenue", () => {
    const [baguetteNet, laitNet] = netLineRevenue([BAGUETTE.lineTotal, LAIT.lineTotal], 150);
    expect(COCA.lineTotal + baguetteNet + laitNet).toBe(2900);
  });

  it("reconciles product profit with the headline profit", () => {
    const [baguetteNet, laitNet] = netLineRevenue([BAGUETTE.lineTotal, LAIT.lineTotal], 150);
    const profit =
      COCA.lineTotal - COCA.cost + (baguetteNet - BAGUETTE.cost) + (laitNet - LAIT.cost);
    expect(profit).toBe(750);
  });

  it("computes the headline margin", () => {
    expect(grossMarginPercent(2900, 2150)).toBeCloseTo(25.86, 2);
  });

  it("computes the average basket", () => {
    expect(averageBasketCents(2900, 2)).toBe(1450);
  });
});

describe("allocateSaleDiscount", () => {
  it("allocates nothing when there is no discount", () => {
    expect(allocateSaleDiscount([1000, 500], 0)).toEqual([0, 0]);
  });

  it("allocates nothing to an empty basket", () => {
    expect(allocateSaleDiscount([], 500)).toEqual([]);
  });

  it("handles a basket whose lines are all free", () => {
    expect(allocateSaleDiscount([0, 0], 500)).toEqual([0, 0]);
  });

  it("gives the whole discount to a single line", () => {
    expect(allocateSaleDiscount([1000], 250)).toEqual([250]);
  });

  it("splits evenly between equal lines", () => {
    expect(allocateSaleDiscount([1000, 1000], 200)).toEqual([100, 100]);
  });
});

describe("averageBasketCents", () => {
  it("is zero with no transactions rather than dividing by zero", () => {
    expect(averageBasketCents(2900, 0)).toBe(0);
  });

  it("rounds to the nearest centime", () => {
    expect(averageBasketCents(1000, 3)).toBe(333);
  });
});

describe("grossMarginPercent", () => {
  it("is unknown with no revenue", () => {
    expect(grossMarginPercent(0, 0)).toBeNull();
  });

  it("goes negative when goods cost more than they sold for", () => {
    expect(grossMarginPercent(1000, 1200)).toBeCloseTo(-20, 5);
  });

  it("is 100% when the goods cost nothing", () => {
    expect(grossMarginPercent(1000, 0)).toBe(100);
  });
});

describe("inventoryPotentialProfitCents", () => {
  it("is retail value less cost value", () => {
    // The seeded shelves: 13129.50 retail, 9826.20 at cost
    expect(inventoryPotentialProfitCents(1312950, 982620)).toBe(330330);
  });
});
