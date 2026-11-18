import {
  centsToInputText,
  checkPaymentAmount,
  ledgerTotals,
  mergeTimeline,
  type LedgerPayment,
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
    expect(totals).toEqual({ tookCents: 1000, paidCents: 300 });
  });
});
