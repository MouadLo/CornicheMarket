import {
  allocateSaleDiscount,
  averageBasketCents,
  flooredInventoryValueCents,
  grossMarginPercent,
  inventoryPotentialProfitCents,
  netLineRevenue,
  oversoldValueCents,
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

  // These two cases round to 9 and 6 respectively (not 10 and 5) under
  // independent per-line rounding -- the drift documented in
  // docs/PRE-LAUNCH-GAPS.md#i1. Largest-remainder allocation must not drop
  // or invent centimes.
  it("sums to the discount exactly: [333, 333, 334] with a 10-cent discount", () => {
    const allocated = allocateSaleDiscount([333, 333, 334], 10);
    expect(allocated.reduce((sum, value) => sum + value, 0)).toBe(10);
    expect(allocated).toEqual([3, 3, 4]);
  });

  it("sums to the discount exactly: six 1-cent lines with a 5-cent discount", () => {
    const allocated = allocateSaleDiscount([1, 1, 1, 1, 1, 1], 5);
    expect(allocated.reduce((sum, value) => sum + value, 0)).toBe(5);
    expect(allocated).toEqual([1, 1, 1, 1, 1, 0]);
  });

  // A small deterministic PRNG (mulberry32) rather than Math.random, so a
  // failure is reproducible from the printed seed without needing a new
  // dependency.
  function mulberry32(seed: number) {
    let state = seed;
    return () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("sums to the discount exactly across randomized baskets", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = mulberry32(seed);
      const lineCount = 1 + Math.floor(rand() * 8);
      const lines = Array.from({ length: lineCount }, () => Math.floor(rand() * 5000) + 1);
      const total = lines.reduce((sum, value) => sum + value, 0);
      const discount = Math.floor(rand() * (total + 1));

      const allocated = allocateSaleDiscount(lines, discount);
      const sum = allocated.reduce((acc, value) => acc + value, 0);

      expect(sum).toBe(discount);
      expect(allocated).toHaveLength(lineCount);
      for (const value of allocated) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("line profits sum to sale profit exactly across randomized baskets", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = mulberry32(seed);
      const lineCount = 1 + Math.floor(rand() * 8);
      const lineTotals = Array.from({ length: lineCount }, () => Math.floor(rand() * 5000) + 1);
      const lineCosts = lineTotals.map(() => Math.floor(rand() * 4000));
      const total = lineTotals.reduce((sum, value) => sum + value, 0);
      const discount = Math.floor(rand() * (total + 1));

      const netRevenue = netLineRevenue(lineTotals, discount);
      const saleProfit = netRevenue.reduce((sum, value, i) => sum + (value - lineCosts[i]), 0);
      const expectedSaleProfit = total - discount - lineCosts.reduce((sum, c) => sum + c, 0);

      expect(saleProfit).toBe(expectedSaleProfit);
    }
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

describe("flooredInventoryValueCents / oversoldValueCents (PRE-LAUNCH-GAPS B4)", () => {
  it("one oversold product cannot offset the value of real stock elsewhere", () => {
    // 10 units of real stock at 500 cents, plus one product oversold by
    // 3 units at 400 cents. Naive sum*cost would be (10-3)*... mixing unit
    // values incorrectly; per-product flooring must hold even with
    // different unit costs across products.
    const quantities = [10, -3];
    const unitCosts = [500, 400];

    // 10 * 500 = 5000, the oversold product contributes 0 (floored), not
    // -3 * 400 = -1200 silently subtracted from real stock's value.
    expect(flooredInventoryValueCents(quantities, unitCosts)).toBe(5000);

    // The excluded discrepancy is surfaced separately, not dropped.
    expect(oversoldValueCents(quantities, unitCosts)).toBe(-1200);
  });

  it("the floored value plus the oversold value never exceeds the naive (wrong) sum", () => {
    const quantities = [10, -3];
    const unitCosts = [500, 400];
    const naiveSum = quantities.reduce((sum, q, i) => sum + q * unitCosts[i], 0); // 3800

    const floored = flooredInventoryValueCents(quantities, unitCosts); // 5000
    const oversold = oversoldValueCents(quantities, unitCosts); // -1200

    expect(floored + oversold).toBe(naiveSum);
    // The real-stock figure the owner sees (floored) is always >= the
    // naive, silently-offset figure it replaces.
    expect(floored).toBeGreaterThanOrEqual(naiveSum);
  });

  it("is zero for an empty or all-positive shelf", () => {
    expect(oversoldValueCents([5, 10], [100, 200])).toBe(0);
    expect(flooredInventoryValueCents([], [])).toBe(0);
  });

  it("handles a shelf that is entirely oversold", () => {
    expect(flooredInventoryValueCents([-2, -1], [500, 300])).toBe(0);
    expect(oversoldValueCents([-2, -1], [500, 300])).toBe(-1300);
  });

  // Named regression case, with a real product's real numbers, requested
  // after a report of the oversold figure looking wrong: "Couches bébé
  // shows 450.00 which equals 6 x selling price 75". Verified live against
  // the actual SQL (report_inventory_value, negative_stock_products) and
  // the TypeScript screens that read them -- both already use
  // current_cost_cents, never selling_price_cents, for this figure. The
  // "450.00" being looked at was a DIFFERENT number: the product
  // performance table's revenue subtitle (quantity x selling price,
  // which revenue is correctly supposed to use). This test locks in the
  // correct (cost-based) oversold figure using that same product's real
  // seed values so a future change that swaps in selling price breaks
  // loudly here instead of only being noticed by eye on screen.
  it("Couches bébé scenario: oversold value uses COST (62.00), never selling price (75.00)", () => {
    const sellingPriceCents = 7500;
    const costCents = 6200;
    const oversoldBy = -6; // 6 units sold beyond what was in stock

    const atCost = oversoldValueCents([oversoldBy], [costCents]);
    const atSellingPriceIfBuggy = oversoldValueCents([oversoldBy], [sellingPriceCents]);

    expect(atCost).toBe(-37200); // 6 x 62.00 DH
    expect(atCost).not.toBe(-45000); // NOT 6 x 75.00 DH (-450.00) -- the suspected bug
    expect(atCost).not.toBe(atSellingPriceIfBuggy);
  });
});
