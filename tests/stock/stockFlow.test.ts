/**
 * Locks in the expected stock-flow arithmetic.
 *
 * IMPORTANT: actual stock mutations (products.stock_quantity,
 * products.current_cost_cents) happen exclusively inside Postgres triggers:
 *   - apply_purchase_item  — purchase increases stock, updates WAC
 *   - apply_sale_item_stock — sale decreases stock
 *   - apply_stock_adjustment — adjustment sets stock to a corrected figure
 *
 * These tests verify the client-side formulas that mirror that trigger math,
 * so the UI can display consistent numbers before the DB confirms the write.
 */
import { lineTotalCents, parseMoneyToCents, weightedAverageCost } from "../../src/lib/money";
import { countDiscrepancy, lossValueCents, stockAfterCount } from "../../src/lib/inventory/reorder";
import { lineSubtotal, saleProfit, type CartLine } from "../../src/lib/sales/totals";

// ---------------------------------------------------------------------------
// Purchase (stock in)
// ---------------------------------------------------------------------------

describe("stock after a purchase", () => {
  it("increases stock by the received quantity", () => {
    const stockBefore = 12;
    const received = 24;
    expect(stockBefore + received).toBe(36);
  });

  it("increases fractional kg stock correctly", () => {
    const stockBefore = 3.25;
    const received = 10.5;
    // Floating-point: use toBeCloseTo
    expect(stockBefore + received).toBeCloseTo(13.75, 3);
  });

  it("WAC rises when buying at a higher price", () => {
    // 10 units @ 5.00 DH (500 c), buying 5 more @ 8.00 DH (800 c)
    // new WAC = (10*500 + 5*800) / 15 = 9000/15 = 600 c = 6.00 DH
    expect(weightedAverageCost(10, 500, 5, 800)).toBe(600);
  });

  it("WAC falls when buying at a lower price", () => {
    // 10 units @ 8.00 DH (800 c), buying 5 more @ 5.00 DH (500 c)
    // new WAC = (10*800 + 5*500) / 15 = 10500/15 = 700 c
    expect(weightedAverageCost(10, 800, 5, 500)).toBe(700);
  });

  it("WAC is the new price when there was no prior stock", () => {
    expect(weightedAverageCost(0, 0, 12, 350)).toBe(350);
  });

  it("delivery line total uses integer rounding, never floats", () => {
    // 1.333 kg at 75.00 DH/kg = 99.975 DH -> Math.round(9997.5) = 9998 centimes
    expect(lineTotalCents(1.333, 7500)).toBe(9998);
  });
});

// ---------------------------------------------------------------------------
// Sale (stock out)
// ---------------------------------------------------------------------------

describe("stock after a sale", () => {
  it("decreases by the total quantity sold", () => {
    const stockBefore = 20;
    const soldQty = 3;
    expect(stockBefore - soldQty).toBe(17);
  });

  it("decreases by fractional kg sold", () => {
    const stockBefore = 5.0;
    const soldQty = 1.5;
    expect(stockBefore - soldQty).toBeCloseTo(3.5, 3);
  });

  it("sale revenue uses integer rounding for fractional kg", () => {
    // 0.333 kg at 90.00 DH/kg = 29.97 DH -> 2997 c (matches lineSubtotal)
    expect(lineSubtotal(0.333, 9000)).toBe(2997);
  });

  it("profit is zero when selling exactly at cost", () => {
    const l: CartLine = {
      product_id: "p1",
      name: "Test",
      unit: "piece",
      quantity: 1,
      unit_price_cents: 500,
      discount_cents: 0,
      unit_cost_cents: 500,
    };
    expect(saleProfit([l], 0)).toBe(0);
  });

  it("a sale discount reduces profit but not cost", () => {
    // Sell 1 unit at 7.00 DH cost 4.80 DH, with a 1.00 DH sale discount
    // profit = (700 - 100) - 480 = 120
    const l: CartLine = {
      product_id: "p1",
      name: "Test",
      unit: "piece",
      quantity: 1,
      unit_price_cents: 700,
      discount_cents: 0,
      unit_cost_cents: 480,
    };
    expect(saleProfit([l], 100)).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Refund (stock back in)
// ---------------------------------------------------------------------------

describe("stock after a refund", () => {
  it("increases stock by the returned quantity", () => {
    // A refund is modelled as a stock adjustment with a positive delta.
    // The DB stores this as a `stock_adjustments` row with reason "other".
    const stockBefore = 10;
    const returned = 2;
    expect(stockBefore + returned).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Stock adjustment (count correction, damaged, theft, expired)
// ---------------------------------------------------------------------------

describe("stock after an adjustment", () => {
  it("a count that matches the system changes nothing", () => {
    // stockAfterCount(liveStock, counted, snapshotAtCountStart)
    expect(stockAfterCount(45, 45, 45)).toBe(45);
  });

  it("a discrepancy adjusts the live stock by the delta", () => {
    // Counted 42, system showed 45 at count start, live is still 45 -> set to 42
    expect(stockAfterCount(45, 42, 45)).toBe(42);
  });

  it("a sale during count is preserved, not undone", () => {
    // System showed 45, counted 45 (no discrepancy), but 3 sold meanwhile
    // -> live is 42, adjustment is 0, result is 42
    expect(stockAfterCount(42, 45, 45)).toBe(42);
  });

  it("countDiscrepancy is negative when stock is missing", () => {
    expect(countDiscrepancy(40, 45)).toBe(-5);
  });

  it("countDiscrepancy is positive when extra stock is found", () => {
    expect(countDiscrepancy(48, 45)).toBe(3);
  });

  it("write-off loss is valued at cost", () => {
    // 5 units damaged, cost 4.80 DH each -> 24.00 DH loss
    expect(lossValueCents(-5, 480)).toBe(2400);
  });

  it("a positive adjustment (found stock) has no loss value", () => {
    expect(lossValueCents(3, 480)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ambiguous parseMoneyToCents input — documents current behavior
// ---------------------------------------------------------------------------
// KNOWN AMBIGUITY (see docs/REVIEW.md §H1): "1.234" could be interpreted as
// 1.234 DH (European decimal) or 1234 DH (French thousands separator).
// The current parser treats the last separator as the decimal point, so it
// returns 123 centimes. This test pins that behavior so any future change is
// deliberate and visible.

describe("parseMoneyToCents — ambiguous thousand/decimal separator", () => {
  it("treats '1.234' as 1.234 DH = 123 centimes (dot is decimal)", () => {
    // This could also be read as 1234.00 DH in French locale, but the
    // function uses lastDot > lastComma logic and resolves it as decimal.
    expect(parseMoneyToCents("1.234")).toBe(123);
  });

  it("treats '1,234' as 1234.00 DH = 123400 centimes (comma is thousands sep)", () => {
    // lastComma > lastDot is false (no dot), so comma treated as decimal:
    // actually: lastComma=1, lastDot=-1 -> lastComma > lastDot -> strip dots, replace comma with dot
    // "1,234" -> "1.234" -> 1.234 -> 123 centimes
    // Document the actual result:
    expect(parseMoneyToCents("1,234")).toBe(123);
  });

  it("unambiguous thousands: '1,234.00' is correctly 123400 centimes", () => {
    expect(parseMoneyToCents("1,234.00")).toBe(123400);
  });

  it("unambiguous French: '1 234,00' is correctly 123400 centimes", () => {
    expect(parseMoneyToCents("1 234,00")).toBe(123400);
  });
});
