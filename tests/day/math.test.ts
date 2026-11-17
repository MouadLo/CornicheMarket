import {
  cashDifferenceCents,
  cashierCashCents,
  expectedCashCents,
  shiftDay,
  sumCashiers,
  type CashierDay,
} from "../../src/lib/day/math";

const row = (extra: Partial<CashierDay>): CashierDay => ({
  cashier_id: "a",
  cashier_name: "A",
  sales_count: 0,
  cash_cents: 0,
  card_cents: 0,
  credit_cents: 0,
  discount_cents: 0,
  voids_count: 0,
  voids_cents: 0,
  cash_payments_cents: 0,
  card_payments_cents: 0,
  ...extra,
});

describe("day close math", () => {
  const rows = [
    row({ sales_count: 2, cash_cents: 1000, card_cents: 500, discount_cents: 50 }),
    row({ sales_count: 1, cash_cents: 400, credit_cents: 250, cash_payments_cents: 300 }),
  ];

  it("adds every cashier up", () => {
    const total = sumCashiers(rows);
    expect(total.sales_count).toBe(3);
    expect(total.cash_cents).toBe(1400);
    expect(total.card_cents).toBe(500);
    expect(total.credit_cents).toBe(250);
    expect(total.cash_payments_cents).toBe(300);
  });

  it("expected cash is the float plus cash sales plus cash repayments", () => {
    expect(expectedCashCents(2000, rows)).toBe(3700);
    expect(expectedCashCents(0, [])).toBe(0);
  });

  it("a cashier hands over cash sales plus the cash repayments they took", () => {
    expect(cashierCashCents(rows[1])).toBe(700);
  });

  it("the difference is counted minus expected: short is negative", () => {
    expect(cashDifferenceCents(3650, 3700)).toBe(-50);
    expect(cashDifferenceCents(3700, 3700)).toBe(0);
    expect(cashDifferenceCents(3750, 3700)).toBe(50);
  });

  it("moves a calendar day across month and year ends", () => {
    expect(shiftDay("2026-11-17", -1)).toBe("2026-11-16");
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });
});
