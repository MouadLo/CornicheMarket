// Day-close arithmetic, mirroring the SQL in migration 037. Integer centimes.

export type CashierDay = {
  cashier_id: string;
  cashier_name: string;
  sales_count: number;
  cash_cents: number;
  card_cents: number;
  credit_cents: number;
  discount_cents: number;
  voids_count: number;
  voids_cents: number;
  cash_payments_cents: number;
  card_payments_cents: number;
};

// What a cashier should hand over: cash sales plus cash repayments they took.
export function cashierCashCents(row: CashierDay): number {
  return row.cash_cents + row.cash_payments_cents;
}

export function sumCashiers(rows: CashierDay[]): CashierDay {
  const total: CashierDay = {
    cashier_id: "",
    cashier_name: "",
    sales_count: 0,
    cash_cents: 0,
    card_cents: 0,
    credit_cents: 0,
    discount_cents: 0,
    voids_count: 0,
    voids_cents: 0,
    cash_payments_cents: 0,
    card_payments_cents: 0,
  };
  for (const row of rows) {
    total.sales_count += row.sales_count;
    total.cash_cents += row.cash_cents;
    total.card_cents += row.card_cents;
    total.credit_cents += row.credit_cents;
    total.discount_cents += row.discount_cents;
    total.voids_count += row.voids_count;
    total.voids_cents += row.voids_cents;
    total.cash_payments_cents += row.cash_payments_cents;
    total.card_payments_cents += row.card_payments_cents;
  }
  return total;
}

export function expectedCashCents(openingFloatCents: number, rows: CashierDay[]): number {
  return openingFloatCents + sumCashiers(rows).cash_cents + sumCashiers(rows).cash_payments_cents;
}

// Positive: more cash than expected. Negative: the drawer is short.
export function cashDifferenceCents(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}

// "2026-11-17" moved by whole days, without touching any time zone.
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
