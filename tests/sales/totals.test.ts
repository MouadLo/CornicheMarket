import {
  cartSubtotal,
  changeDue,
  costOfGoods,
  isShortPayment,
  lineSubtotal,
  lineTotal,
  saleProfit,
  saleTotal,
  totalItemCount,
  type CartLine,
} from "../../src/lib/sales/totals";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    product_id: "p1",
    name: "Coca-Cola 33cl",
    unit: "piece",
    quantity: 1,
    unit_price_cents: 700,
    discount_cents: 0,
    unit_cost_cents: 480,
    ...overrides,
  };
}

describe("lineSubtotal", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineSubtotal(3, 700)).toBe(2100);
  });

  it("rounds fractional kg quantities to whole centimes", () => {
    // 1.5 kg at 6.00 DH/kg
    expect(lineSubtotal(1.5, 600)).toBe(900);
    // 0.333 kg at 85.00 DH/kg = 28.305 -> 28.31
    expect(lineSubtotal(0.333, 8500)).toBe(2831);
  });
});

describe("lineTotal", () => {
  it("subtracts the line discount", () => {
    expect(lineTotal(line({ quantity: 3, discount_cents: 200 }))).toBe(1900);
  });

  it("never goes negative when the discount exceeds the line", () => {
    expect(lineTotal(line({ quantity: 1, discount_cents: 99999 }))).toBe(0);
  });
});

describe("cartSubtotal", () => {
  it("adds up the lines", () => {
    expect(cartSubtotal([line({ quantity: 2 }), line({ product_id: "p2", unit_price_cents: 150 })])).toBe(
      1550
    );
  });

  it("is zero for an empty cart", () => {
    expect(cartSubtotal([])).toBe(0);
  });
});

describe("saleTotal", () => {
  it("applies the sale-level discount after the lines", () => {
    expect(saleTotal([line({ quantity: 2 })], 200)).toBe(1200);
  });

  it("combines line and sale discounts", () => {
    expect(saleTotal([line({ quantity: 2, discount_cents: 100 })], 200)).toBe(1100);
  });

  it("never goes negative", () => {
    expect(saleTotal([line()], 99999)).toBe(0);
  });

  it("ignores a negative sale discount", () => {
    expect(saleTotal([line()], -500)).toBe(700);
  });
});

describe("changeDue", () => {
  it("returns what the customer gets back", () => {
    expect(changeDue(10000, 7350)).toBe(2650);
  });

  it("is zero on exact payment", () => {
    expect(changeDue(7350, 7350)).toBe(0);
  });

  it("is never negative when the customer underpays", () => {
    expect(changeDue(5000, 7350)).toBe(0);
  });
});

describe("isShortPayment", () => {
  it("flags an underpayment", () => {
    expect(isShortPayment(5000, 7350)).toBe(true);
  });

  it("accepts exact payment", () => {
    expect(isShortPayment(7350, 7350)).toBe(false);
  });
});

describe("costOfGoods", () => {
  it("sums cost times quantity", () => {
    expect(costOfGoods([line({ quantity: 2 })])).toBe(960);
  });

  it("is unknown when any line hides its cost, as for a cashier", () => {
    expect(costOfGoods([line(), line({ product_id: "p2", unit_cost_cents: null })])).toBeNull();
  });
});

describe("saleProfit", () => {
  it("is revenue minus cost of goods", () => {
    // 2 @ 7.00 = 14.00 revenue, cost 2 @ 4.80 = 9.60 -> 4.40 profit
    expect(saleProfit([line({ quantity: 2 })], 0)).toBe(440);
  });

  it("is reduced by a line discount", () => {
    expect(saleProfit([line({ quantity: 2, discount_cents: 100 })], 0)).toBe(340);
  });

  it("is reduced by a sale discount exactly once", () => {
    expect(saleProfit([line({ quantity: 2 })], 200)).toBe(240);
  });

  it("counts both discount kinds once each", () => {
    expect(saleProfit([line({ quantity: 2, discount_cents: 100 })], 200)).toBe(140);
  });

  it("goes negative when discounted below cost", () => {
    expect(saleProfit([line({ quantity: 1 })], 500)).toBe(-280);
  });

  it("handles a mixed cart", () => {
    const lines = [
      line({ quantity: 2 }),
      line({ product_id: "p2", unit_price_cents: 1500, unit_cost_cents: 1050, quantity: 1 }),
    ];
    // revenue 1400 + 1500 = 2900, cost 960 + 1050 = 2010 -> 890
    expect(saleProfit(lines, 0)).toBe(890);
  });

  it("is unknown when costs are hidden", () => {
    expect(saleProfit([line({ unit_cost_cents: null })], 0)).toBeNull();
  });

  it("prices weighted items correctly", () => {
    // 1.5 kg sold at 9.00/kg costing 6.00/kg -> revenue 1350, cost 900
    const kg = line({ quantity: 1.5, unit_price_cents: 900, unit_cost_cents: 600, unit: "kg" });
    expect(saleProfit([kg], 0)).toBe(450);
  });
});

// Pinned against record_sale running in Postgres, so the figure shown at the
// counter cannot drift from the total the database stores.
describe("totals match what record_sale computes in the database", () => {
  it("2 @ 7.00 with a 1.00 sale discount is 13.00", () => {
    expect(saleTotal([line({ quantity: 2 })], 100)).toBe(1300);
  });

  it("the same product on two lines (3 + 2 @ 1.50) is 7.50", () => {
    const baguette = { unit_price_cents: 150, unit_cost_cents: 80 };
    expect(
      saleTotal(
        [
          line({ product_id: "b1", quantity: 3, ...baguette }),
          line({ product_id: "b2", quantity: 2, ...baguette }),
        ],
        0
      )
    ).toBe(750);
  });
});

describe("totalItemCount", () => {
  it("adds quantities including fractional ones", () => {
    expect(totalItemCount([line({ quantity: 2 }), line({ product_id: "p2", quantity: 1.5 })])).toBe(3.5);
  });
});
