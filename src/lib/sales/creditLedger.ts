import { parseMoneyToCents } from "@/src/lib/money";

// Pure helpers for the credit ledger (clients list and a customer's history).
// Money stays in integer centimes.

export type PaymentCheck =
  { ok: true; cents: number } | { ok: false; reason: "empty" | "invalid" | "over" };

// May this amount be recorded against a customer who owes `balanceCents`?
// Zero, negative or unparsable amounts are refused ("invalid"; "empty" is the
// untouched box, which disables recording without scolding). An amount above
// the balance is refused ("over"): it would silently turn into credit.
export function checkPaymentAmount(raw: string, balanceCents: number): PaymentCheck {
  if (raw.trim() === "") return { ok: false, reason: "empty" };
  const cents = parseMoneyToCents(raw);
  if (cents === null || !Number.isInteger(cents) || cents <= 0) {
    return { ok: false, reason: "invalid" };
  }
  if (cents > balanceCents) return { ok: false, reason: "over" };
  return { ok: true, cents };
}

// The balance as the text of the amount box ("Pay in full"): "12.50", built
// from integers so there is no float drift.
export function centsToInputText(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export type LedgerSale = {
  kind: "sale";
  id: string;
  instant: string;
  total_cents: number;
  voided_at: string | null;
  void_reason: string | null;
  // Who rang the sale up, and whether it is the signed-in user's own sale.
  cashier_name?: string | null;
  is_own?: boolean;
};
export type LedgerPayment = {
  kind: "payment";
  id: string;
  instant: string;
  amount_cents: number;
};
// A return of items bought on credit, refunded on the account: lowers the debt
// like a payment (migration 046).
export type LedgerReturn = {
  kind: "return";
  id: string;
  instant: string;
  refund_cents: number;
  item_count: number;
};
export type LedgerEntry = LedgerSale | LedgerPayment | LedgerReturn;

// Newest first; ties broken by id so the order is stable.
function newestFirst(a: LedgerEntry, b: LedgerEntry): number {
  const delta = Date.parse(b.instant) - Date.parse(a.instant);
  if (delta !== 0) return delta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Credit sales, payments and credit returns come from three paged queries.
// Showing them merged is only correct down to the older edge of any list that
// still has more rows: below that edge another list could be missing entries.
// So the timeline stops at the NEWEST of those edges, and loading more moves it
// down. The returns arguments come last so older callers keep working.
export function mergeTimeline(
  sales: LedgerSale[],
  payments: LedgerPayment[],
  salesHaveMore: boolean,
  paymentsHaveMore: boolean,
  returns: LedgerReturn[] = [],
  returnsHaveMore = false
): LedgerEntry[] {
  const merged = [...sales, ...payments, ...returns].sort(newestFirst);
  const edges: number[] = [];
  if (salesHaveMore && sales.length > 0) edges.push(Date.parse(sales[sales.length - 1].instant));
  if (paymentsHaveMore && payments.length > 0) {
    edges.push(Date.parse(payments[payments.length - 1].instant));
  }
  if (returnsHaveMore && returns.length > 0) {
    edges.push(Date.parse(returns[returns.length - 1].instant));
  }
  if (edges.length === 0) return merged;
  const edge = Math.max(...edges);
  return merged.filter((entry) => Date.parse(entry.instant) >= edge);
}

// What the screen shows next to the balance, recomputed from the loaded rows
// only for tests: voided sales never count (customer_balances sums credit sales
// with voided_at is null and every payment), and credit returns come off what
// was taken on credit (migration 046), so
// tookCents - paidCents is customer_balances.balance_cents.
export function ledgerTotals(entries: LedgerEntry[]): {
  tookCents: number;
  paidCents: number;
  balanceCents: number;
} {
  let tookCents = 0;
  let paidCents = 0;
  for (const entry of entries) {
    if (entry.kind === "payment") paidCents += entry.amount_cents;
    else if (entry.kind === "return") tookCents -= entry.refund_cents;
    else if (!entry.voided_at) tookCents += entry.total_cents;
  }
  return { tookCents, paidCents, balanceCents: tookCents - paidCents };
}
