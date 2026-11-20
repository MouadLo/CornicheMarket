import {
  DEFAULT_CREDIT_LIMIT_CENTS,
  creditAvailableCents,
  creditLimitProblem,
  customerCreditState,
  effectiveCreditLimitCents,
  withPendingCredit,
} from "../../src/lib/sales/creditLimit";

describe("effective credit limit", () => {
  it("uses the customer's own limit, else the store default", () => {
    expect(effectiveCreditLimitCents(null, 30000)).toBe(30000);
    expect(effectiveCreditLimitCents(undefined, 30000)).toBe(30000);
    expect(effectiveCreditLimitCents(100000, 30000)).toBe(100000);
    expect(effectiveCreditLimitCents(5000, 30000)).toBe(5000);
    // 0 is a real limit (no credit), not "unset".
    expect(effectiveCreditLimitCents(0, 30000)).toBe(0);
  });

  it("the built-in default is 300 DH", () => {
    expect(DEFAULT_CREDIT_LIMIT_CENTS).toBe(30000);
  });
});

describe("credit available", () => {
  it("is the room under the limit, never below 0", () => {
    expect(creditAvailableCents(10000, 30000)).toBe(20000);
    expect(creditAvailableCents(30000, 30000)).toBe(0);
    expect(creditAvailableCents(45000, 30000)).toBe(0);
    // A customer in credit (negative balance) has more room.
    expect(creditAvailableCents(-5000, 30000)).toBe(35000);
  });
});

describe("creditLimitProblem", () => {
  it("is null while the sale keeps the customer at or under the limit", () => {
    expect(creditLimitProblem(0, 30000, 30000)).toBeNull();
    expect(creditLimitProblem(10000, 20000, 30000)).toBeNull();
    expect(creditLimitProblem(0, 100, 30000)).toBeNull();
  });

  it("says how much is still available when the sale goes over", () => {
    expect(creditLimitProblem(25000, 6000, 30000)).toEqual({
      kind: "over",
      availableCents: 5000,
      limitCents: 30000,
    });
    // One centime over is over.
    expect(creditLimitProblem(30000, 1, 30000)).toEqual({
      kind: "over",
      availableCents: 0,
      limitCents: 30000,
    });
  });

  it("a limit of 0 means no credit at all", () => {
    expect(creditLimitProblem(0, 100, 0)).toEqual({ kind: "noCredit" });
    expect(creditLimitProblem(5000, 100, 0)).toEqual({ kind: "noCredit" });
  });

  it("a customer already over their limit has nothing available", () => {
    expect(creditLimitProblem(50000, 100, 30000)).toEqual({
      kind: "over",
      availableCents: 0,
      limitCents: 30000,
    });
  });

  it("a prepaid customer gets room for what they paid ahead", () => {
    expect(creditLimitProblem(-10000, 40000, 30000)).toBeNull();
    expect(creditLimitProblem(-10000, 40100, 30000)?.kind).toBe("over");
  });
});

describe("customerCreditState", () => {
  it("uses the server's effective limit and the balance", () => {
    expect(customerCreditState({ balance_cents: 8000, credit_limit_cents: 50000 }, 30000)).toEqual({
      balanceCents: 8000,
      limitCents: 50000,
      availableCents: 42000,
    });
  });

  it("falls back to the store default and a balance of 0 for a customer made on this device", () => {
    expect(customerCreditState({}, 30000)).toEqual({
      balanceCents: 0,
      limitCents: 30000,
      availableCents: 30000,
    });
    expect(customerCreditState(undefined, 12000).limitCents).toBe(12000);
  });

  it("keeps a limit of 0", () => {
    expect(customerCreditState({ balance_cents: 0, credit_limit_cents: 0 }, 30000).limitCents).toBe(
      0
    );
  });
});

describe("withPendingCredit", () => {
  const customers = [{ id: "a", balance_cents: 1000 }, { id: "b" }, { id: "c", balance_cents: 0 }];

  it("adds queued credit sales to the balance the server reported", () => {
    const result = withPendingCredit(customers, [
      { customer_id: "a", payment_method: "credit", total_cents: 500 },
      { customer_id: "a", payment_method: "credit", total_cents: 250 },
      { customer_id: "b", payment_method: "credit", total_cents: 700 },
      { customer_id: "c", payment_method: "cash", total_cents: 9999 },
      { customer_id: null, payment_method: "credit", total_cents: 9999 },
    ]);
    expect(result).toEqual([
      { id: "a", balance_cents: 1750 },
      { id: "b", balance_cents: 700 },
      { id: "c", balance_cents: 0 },
    ]);
  });

  it("returns the list unchanged when nothing is queued", () => {
    expect(withPendingCredit(customers, [])).toBe(customers);
  });
});
