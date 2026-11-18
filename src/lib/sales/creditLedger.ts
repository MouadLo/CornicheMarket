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
};
export type LedgerPayment = {
  kind: "payment";
  id: string;
  instant: string;
  amount_cents: number;
};
export type LedgerEntry = LedgerSale | LedgerPayment;

// Newest first; ties broken by id so the order is stable.
function newestFirst(a: LedgerEntry, b: LedgerEntry): number {
  const delta = Date.parse(b.instant) - Date.parse(a.instant);
  if (delta !== 0) return delta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Credit sales and payments come from two paged queries. Showing both lists
// merged is only correct down to the older edge of any list that still has
// more rows: below that edge the other list could be missing entries. So the
// timeline stops at the NEWER of those edges, and loading more moves it down.
export function mergeTimeline(
  sales: LedgerSale[],
  payments: LedgerPayment[],
  salesHaveMore: boolean,
  paymentsHaveMore: boolean
): LedgerEntry[] {
  const merged = [...sales, ...payments].sort(newestFirst);
  const edges: number[] = [];
  if (salesHaveMore && sales.length > 0) edges.push(Date.parse(sales[sales.length - 1].instant));
  if (paymentsHaveMore && payments.length > 0) {
    edges.push(Date.parse(payments[payments.length - 1].instant));
  }
  if (edges.length === 0) return merged;
  const edge = Math.max(...edges);
  return merged.filter((entry) => Date.parse(entry.instant) >= edge);
}

// What the screen shows next to the balance, recomputed from the loaded rows
// only for tests: voided sales never count (customer_balances, migration 012,
// sums credit sales with voided_at is null and every payment).
export function ledgerTotals(entries: LedgerEntry[]): { tookCents: number; paidCents: number } {
  let tookCents = 0;
  let paidCents = 0;
  for (const entry of entries) {
    if (entry.kind === "payment") paidCents += entry.amount_cents;
    else if (!entry.voided_at) tookCents += entry.total_cents;
  }
  return { tookCents, paidCents };
}
