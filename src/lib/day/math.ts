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
  // Item returns (migration 046), booked to the cashier who rang the sale up and
  // dated by when the return was made. Optional: a server older than 046 sends
  // none, which reads as no returns.
  refunds_count?: number;
  cash_refunds_cents?: number;
  card_refunds_cents?: number;
  credit_refunds_cents?: number;
};

// Cash given back to customers that day: it left the drawer.
export function cashRefundsCents(row: CashierDay): number {
  return row.cash_refunds_cents ?? 0;
}

export function refundsTotalCents(row: CashierDay): number {
  return (
    (row.cash_refunds_cents ?? 0) + (row.card_refunds_cents ?? 0) + (row.credit_refunds_cents ?? 0)
  );
}

// Sales by payment method net of the returns refunded the same way: a card
// refund lowers the card total, a cash refund the cash total.
export function netCashCents(row: CashierDay): number {
  return row.cash_cents - (row.cash_refunds_cents ?? 0);
}
export function netCardCents(row: CashierDay): number {
  return row.card_cents - (row.card_refunds_cents ?? 0);
}
export function netCreditCents(row: CashierDay): number {
  return row.credit_cents - (row.credit_refunds_cents ?? 0);
}

// What a cashier should hand over: cash sales plus cash repayments they took,
// minus the cash refunded on returns.
export function cashierCashCents(row: CashierDay): number {
  return row.cash_cents + row.cash_payments_cents - cashRefundsCents(row);
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
    refunds_count: 0,
    cash_refunds_cents: 0,
    card_refunds_cents: 0,
    credit_refunds_cents: 0,
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
    total.refunds_count = (total.refunds_count ?? 0) + (row.refunds_count ?? 0);
    total.cash_refunds_cents = (total.cash_refunds_cents ?? 0) + (row.cash_refunds_cents ?? 0);
    total.card_refunds_cents = (total.card_refunds_cents ?? 0) + (row.card_refunds_cents ?? 0);
    total.credit_refunds_cents =
      (total.credit_refunds_cents ?? 0) + (row.credit_refunds_cents ?? 0);
  }
  return total;
}

// Float + cash sales + cash repayments - cash refunds (close_day, migration 046).
export function expectedCashCents(openingFloatCents: number, rows: CashierDay[]): number {
  return openingFloatCents + cashierCashCents(sumCashiers(rows));
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
