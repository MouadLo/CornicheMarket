import {
  centsToInputText,
  checkPaymentAmount,
  ledgerTotals,
  mergeTimeline,
  type LedgerPayment,
  type LedgerReturn,
  type LedgerSale,
} from "../../src/lib/sales/creditLedger";

describe("checkPaymentAmount", () => {
  it("accepts an amount up to the balance, exactly the balance included", () => {
    expect(checkPaymentAmount("12.50", 1250)).toEqual({ ok: true, cents: 1250 });
    expect(checkPaymentAmount("5", 1250)).toEqual({ ok: true, cents: 500 });
    expect(checkPaymentAmount("0,01", 1250)).toEqual({ ok: true, cents: 1 });
  });
  it("refuses more than the balance", () => {
    expect(checkPaymentAmount("12.51", 1250)).toEqual({ ok: false, reason: "over" });
    expect(checkPaymentAmount("100", 1250)).toEqual({ ok: false, reason: "over" });
  });
  it("refuses zero, negative and unparsable amounts", () => {
    expect(checkPaymentAmount("0", 1250)).toEqual({ ok: false, reason: "invalid" });
    expect(checkPaymentAmount("0.00", 1250)).toEqual({ ok: false, reason: "invalid" });
    expect(checkPaymentAmount("-5", 1250)).toEqual({ ok: false, reason: "invalid" });
    expect(checkPaymentAmount("abc", 1250)).toEqual({ ok: false, reason: "invalid" });
  });
  it("treats an untouched box as empty", () => {
    expect(checkPaymentAmount("  ", 1250)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("centsToInputText", () => {
  it("writes the balance exactly, without float drift", () => {
    expect(centsToInputText(1250)).toBe("12.50");
    expect(centsToInputText(5)).toBe("0.05");
    expect(centsToInputText(100000)).toBe("1000.00");
    expect(checkPaymentAmount(centsToInputText(1999), 1999)).toEqual({ ok: true, cents: 1999 });
  });
});

const sale = (id: string, instant: string, total = 100, voided = false): LedgerSale => ({
  kind: "sale",
  id,
  instant,
  total_cents: total,
  voided_at: voided ? instant : null,
  void_reason: null,
});
const pay = (id: string, instant: string, amount = 50): LedgerPayment => ({
  kind: "payment",
  id,
  instant,
  amount_cents: amount,
});

describe("mergeTimeline", () => {
  it("mixes sales and payments newest first", () => {
    const merged = mergeTimeline(
      [sale("s2", "2026-11-17T10:00:00Z"), sale("s1", "2026-11-15T10:00:00Z")],
      [pay("p1", "2026-11-16T10:00:00Z")],
      false,
      false
    );
    expect(merged.map((e) => e.id)).toEqual(["s2", "p1", "s1"]);
  });
  it("stops at the newer edge of a list that has more, so nothing is missing below it", () => {
    const merged = mergeTimeline(
      [sale("s2", "2026-11-17T10:00:00Z"), sale("s1", "2026-11-10T10:00:00Z")],
      [pay("p2", "2026-11-16T10:00:00Z"), pay("p1", "2026-11-14T10:00:00Z")],
      true,
      false
    );
    // only the sales list has more (older than 11-10): everything newer shows.
    expect(merged.map((e) => e.id)).toEqual(["s2", "p2", "p1", "s1"]);
    const both = mergeTimeline(
      [sale("s2", "2026-11-17T10:00:00Z"), sale("s1", "2026-11-10T10:00:00Z")],
      [pay("p2", "2026-11-16T10:00:00Z"), pay("p1", "2026-11-14T10:00:00Z")],
      true,
      true
    );
    // payments may hide rows older than 11-14: s1 (11-10) is cut.
    expect(both.map((e) => e.id)).toEqual(["s2", "p2", "p1"]);
  });
});

describe("ledgerTotals", () => {
  it("leaves voided sales out, as customer_balances does", () => {
    const totals = ledgerTotals([
      sale("a", "2026-11-17T10:00:00Z", 1000),
      sale("b", "2026-11-17T09:00:00Z", 700, true),
      pay("c", "2026-11-17T11:00:00Z", 300),
    ]);
    expect(totals).toEqual({ tookCents: 1000, paidCents: 300, balanceCents: 700 });
  });
});

describe("credit returns in the timeline", () => {
  const ret = (id: string, at: string, cents: number): LedgerReturn => ({
    kind: "return",
    id,
    instant: at,
    refund_cents: cents,
    item_count: 1,
  });

  it("adds up to customer_balances: returns come off what was taken on credit", () => {
    // 1000 + 500 credit sales, a voided 700, 300 paid, 400 refunded on account.
    const totals = ledgerTotals([
      sale("a", "2026-11-10T10:00:00Z", 1000),
      sale("b", "2026-11-11T10:00:00Z", 500),
      sale("c", "2026-11-12T10:00:00Z", 700, true),
      pay("p", "2026-11-13T10:00:00Z", 300),
      ret("r", "2026-11-14T10:00:00Z", 400),
    ]);
    expect(totals).toEqual({ tookCents: 1100, paidCents: 300, balanceCents: 800 });
  });

  it("merges three sources newest first without duplicates", () => {
    const merged = mergeTimeline(
      [sale("s1", "2026-11-10T10:00:00Z", 100)],
      [pay("p1", "2026-11-12T10:00:00Z", 100)],
      false,
      false,
      [ret("r1", "2026-11-11T10:00:00Z", 100)],
      false
    );
    expect(merged.map((e) => e.id)).toEqual(["p1", "r1", "s1"]);
  });

  it("stops at the newest edge of any list that has more, so paging leaves no gap", () => {
    const sales = [
      sale("s2", "2026-11-14T10:00:00Z", 100),
      sale("s1", "2026-11-05T10:00:00Z", 100),
    ];
    const payments = [pay("p1", "2026-11-13T10:00:00Z", 100)];
    const returns = [
      ret("r2", "2026-11-12T10:00:00Z", 100),
      ret("r1", "2026-11-09T10:00:00Z", 100),
    ];
    // Returns have more below 11-09: nothing older than that is shown, though
    // sales already reached 11-05.
    expect(mergeTimeline(sales, payments, false, false, returns, true).map((e) => e.id)).toEqual([
      "s2",
      "p1",
      "r2",
      "r1",
    ]);
    // Loading the next page of returns moves the edge down.
    const more = [...returns, ret("r0", "2026-11-02T10:00:00Z", 100)];
    expect(mergeTimeline(sales, payments, false, false, more, false).map((e) => e.id)).toEqual([
      "s2",
      "p1",
      "r2",
      "r1",
      "s1",
      "r0",
    ]);
  });
});
