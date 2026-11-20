// The customer debt limit. The device enforces it for a cashier (it must work
// offline); the server never rejects a sale for it, it only flags one that got
// past a device (sales.needs_credit_review). The owner is not limited.
// Every amount is integer centimes.

// The store default out of the box (300 DH): used until a device has read the
// real one.
export const DEFAULT_CREDIT_LIMIT_CENTS = 30000;

export type CreditLimitProblem =
  // This sale would take what the customer owes above their limit; the cashier
  // may still put `availableCents` on credit.
  | { kind: "over"; availableCents: number; limitCents: number }
  // The customer has no credit at all (limit 0).
  | { kind: "noCredit" };

// A customer's own limit when they have one (null / undefined = none), else
// the store default.
export function effectiveCreditLimitCents(
  ownLimitCents: number | null | undefined,
  storeDefaultCents: number
): number {
  return typeof ownLimitCents === "number" ? ownLimitCents : storeDefaultCents;
}

// What the customer may still take on credit: never below 0, even when they
// already owe more than the limit.
export function creditAvailableCents(balanceCents: number, limitCents: number): number {
  return Math.max(0, limitCents - balanceCents);
}

// null when putting `saleTotalCents` on credit keeps the customer at or under
// their limit. Exactly the limit is fine ("above" is strict, like the server).
export function creditLimitProblem(
  balanceCents: number,
  saleTotalCents: number,
  limitCents: number
): CreditLimitProblem | null {
  if (balanceCents + saleTotalCents <= limitCents) return null;
  if (limitCents <= 0) return { kind: "noCredit" };
  return {
    kind: "over",
    availableCents: creditAvailableCents(balanceCents, limitCents),
    limitCents,
  };
}

export type CreditCustomer = {
  balance_cents?: number;
  // The effective limit as the server computed it; absent on a customer
  // created on this device or cached before the limit existed.
  credit_limit_cents?: number | null;
};

// What the counter needs to know about one customer.
export function customerCreditState(
  customer: CreditCustomer | null | undefined,
  storeDefaultCents: number
): { balanceCents: number; limitCents: number; availableCents: number } {
  const balanceCents = customer?.balance_cents ?? 0;
  const limitCents = effectiveCreditLimitCents(customer?.credit_limit_cents, storeDefaultCents);
  return {
    balanceCents,
    limitCents,
    availableCents: creditAvailableCents(balanceCents, limitCents),
  };
}

// Adds credit sales still waiting in the offline queue to the balances the
// server reported: the server has not seen them yet.
export function withPendingCredit<T extends { id: string; balance_cents?: number }>(
  customers: T[],
  pending: { customer_id: string | null; payment_method: string; total_cents: number }[]
): T[] {
  const extra = new Map<string, number>();
  for (const sale of pending) {
    if (sale.payment_method !== "credit" || !sale.customer_id) continue;
    extra.set(sale.customer_id, (extra.get(sale.customer_id) ?? 0) + sale.total_cents);
  }
  if (extra.size === 0) return customers;
  return customers.map((customer) =>
    extra.has(customer.id)
      ? {
          ...customer,
          balance_cents: (customer.balance_cents ?? 0) + (extra.get(customer.id) ?? 0),
        }
      : customer
  );
}
