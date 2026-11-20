import {
  defaultRefundMethod,
  describeReturnError,
  fullyReturned,
  netAfterReturnsCents,
  parseReturnQuantity,
  refundForQuantityCents,
  refundMethodsFor,
  remainingQuantity,
  returnErrorKey,
  returnItemsPayload,
  returnReasonValid,
  returnedByLine,
  returnedLineCount,
  summarizeReturn,
  type ReturnableLine,
  type SaleReturnRecord,
} from "../../src/lib/sales/returns";

// The worked example of tests/sales/saleReturns.sql, which the database ran:
// 3 units of a line the customer paid 2657 for (3000 less its 343 share of the
// sale discount) come back one at a time: 886, 885, then the remainder 886.
const line = (extra: Partial<ReturnableLine> = {}): ReturnableLine => ({
  saleItemId: "l1",
  quantity: 3,
  returnedQuantity: 0,
  paidCents: 2657,
  refundedCents: 0,
  ...extra,
});

describe("refund of a returned quantity", () => {
  it("is the paid share rounded half up, and the last unit takes the remainder", () => {
    expect(refundForQuantityCents(line(), 1)).toBe(886); // 885.67
    expect(refundForQuantityCents(line({ returnedQuantity: 1, refundedCents: 886 }), 1)).toBe(885);
    expect(refundForQuantityCents(line({ returnedQuantity: 2, refundedCents: 1771 }), 1)).toBe(886);
  });

  it("never lets the refunds of one line exceed what was paid, whatever the split", () => {
    for (const paid of [1, 7, 100, 333, 2657, 9999]) {
      for (const sold of [1, 2, 3, 7]) {
        let returned = 0;
        let refunded = 0;
        while (returned < sold) {
          const current = line({
            quantity: sold,
            returnedQuantity: returned,
            paidCents: paid,
            refundedCents: refunded,
          });
          refunded += refundForQuantityCents(current, 1);
          returned += 1;
          expect(refunded).toBeLessThanOrEqual(paid);
        }
        expect(refunded).toBe(paid);
      }
    }
  });

  it("returning everything at once refunds exactly what was paid", () => {
    expect(refundForQuantityCents(line(), 3)).toBe(2657);
    expect(refundForQuantityCents(line({ returnedQuantity: 1, refundedCents: 886 }), 2)).toBe(1771);
  });

  it("does the same for weighed products, to the gram", () => {
    const weighed = line({ quantity: 1.25, paidCents: 2500 });
    expect(refundForQuantityCents(weighed, 0.5)).toBe(1000);
    const after = line({
      quantity: 1.25,
      paidCents: 2500,
      returnedQuantity: 0.5,
      refundedCents: 1000,
    });
    expect(refundForQuantityCents(after, 0.75)).toBe(1500);
    expect(remainingQuantity(after)).toBe(0.75);
    // 0.333 kg of 1 kg paid 1000: 333, then the rest.
    expect(refundForQuantityCents(line({ quantity: 1, paidCents: 1000 }), 0.333)).toBe(333);
  });

  it("refunds nothing for a quantity that is not there", () => {
    expect(refundForQuantityCents(line(), 0)).toBe(0);
    expect(refundForQuantityCents(line(), 4)).toBe(0);
    expect(refundForQuantityCents(line({ returnedQuantity: 3, refundedCents: 2657 }), 1)).toBe(0);
  });

  it("a free line (paid nothing) refunds nothing but can still come back", () => {
    const free = line({ paidCents: 0 });
    expect(refundForQuantityCents(free, 1)).toBe(0);
    expect(refundForQuantityCents(free, 3)).toBe(0);
  });
});

describe("remaining quantity", () => {
  it("is sold minus returned, never negative, free of float drift", () => {
    expect(remainingQuantity(line())).toBe(3);
    expect(remainingQuantity(line({ returnedQuantity: 1 }))).toBe(2);
    expect(remainingQuantity(line({ quantity: 0.3, returnedQuantity: 0.1 }))).toBe(0.2);
    expect(remainingQuantity(line({ returnedQuantity: 3 }))).toBe(0);
  });
});

describe("quantity typed in a box", () => {
  it("is capped at what remains and read to the gram", () => {
    expect(parseReturnQuantity("2", 3)).toBe(2);
    expect(parseReturnQuantity("9", 3)).toBe(3);
    expect(parseReturnQuantity("0,5", 1.25)).toBe(0.5);
    expect(parseReturnQuantity("0.1234", 1.25)).toBe(0.123);
  });

  it("is 0 for anything that is not a positive number", () => {
    for (const raw of ["", "abc", "-1", "0", "0."]) {
      expect(parseReturnQuantity(raw, 3)).toBe(0);
    }
  });
});

describe("summary of a return", () => {
  const lines = [
    line({ saleItemId: "a", quantity: 3, paidCents: 2657 }),
    line({ saleItemId: "b", quantity: 1, paidCents: 443 }),
    line({
      saleItemId: "c",
      quantity: 2,
      paidCents: 1000,
      returnedQuantity: 2,
      refundedCents: 1000,
    }),
  ];

  it("lists the picked lines with their refunds and the total", () => {
    const summary = summarizeReturn(lines, { a: 1, b: 1 });
    expect(summary.items).toEqual([
      { saleItemId: "a", quantity: 1, refundCents: 886 },
      { saleItemId: "b", quantity: 1, refundCents: 443 },
    ]);
    expect(summary.totalCents).toBe(1329);
    expect(returnItemsPayload(summary)).toEqual([
      { sale_item_id: "a", quantity: 1 },
      { sale_item_id: "b", quantity: 1 },
    ]);
  });

  it("caps each quantity at what remains and skips lines at zero or fully returned", () => {
    const summary = summarizeReturn(lines, { a: 99, b: 0, c: 1 });
    expect(summary.items).toEqual([{ saleItemId: "a", quantity: 3, refundCents: 2657 }]);
    expect(summary.totalCents).toBe(2657);
  });

  it("is empty when nothing is picked", () => {
    expect(summarizeReturn(lines, {})).toEqual({ items: [], totalCents: 0 });
  });
});

describe("refund methods", () => {
  it("cash and card sales refund in cash or card, defaulting to how they were paid", () => {
    expect(refundMethodsFor("cash")).toEqual(["cash", "card"]);
    expect(refundMethodsFor("card")).toEqual(["cash", "card"]);
    expect(defaultRefundMethod("cash")).toBe("cash");
    expect(defaultRefundMethod("card")).toBe("card");
  });

  it("a credit sale can only lower the customer's debt", () => {
    expect(refundMethodsFor("credit")).toEqual(["credit"]);
    expect(defaultRefundMethod("credit")).toBe("credit");
  });
});

describe("reason", () => {
  it("needs a preset, and a note for Other", () => {
    expect(returnReasonValid(null, "")).toBe(false);
    expect(returnReasonValid("damaged", "")).toBe(true);
    expect(returnReasonValid("other", "  ")).toBe(false);
    expect(returnReasonValid("other", "melted")).toBe(true);
  });
});

describe("what the history shows", () => {
  const record = (id: string, items: SaleReturnRecord["items"]): SaleReturnRecord => ({
    id,
    saleId: "s1",
    createdAt: "2026-11-17T10:00:00Z",
    reasonCode: "damaged",
    note: null,
    refundMethod: "cash",
    refundCents: items.reduce((sum, item) => sum + item.refundCents, 0),
    items,
  });
  const returns = [
    record("r1", [{ saleItemId: "a", quantity: 1, refundCents: 886 }]),
    record("r2", [
      { saleItemId: "a", quantity: 1, refundCents: 885 },
      { saleItemId: "b", quantity: 0.5, refundCents: 200 },
    ]),
  ];

  it("adds up what was handed back per line across returns", () => {
    const byLine = returnedByLine(returns);
    expect(byLine.get("a")).toEqual({ quantity: 2, refundCents: 1771 });
    expect(byLine.get("b")).toEqual({ quantity: 0.5, refundCents: 200 });
    expect(returnedLineCount(returns)).toBe(2);
  });

  it("shows the sale total after returns", () => {
    expect(netAfterReturnsCents(3100, returns)).toBe(3100 - 886 - 885 - 200);
    expect(netAfterReturnsCents(3100, [])).toBe(3100);
  });

  it("knows when nothing is left to return", () => {
    const lines = [
      { id: "a", quantity: 2 },
      { id: "b", quantity: 0.5 },
    ];
    expect(fullyReturned(lines, returns)).toBe(true);
    expect(fullyReturned([{ id: "a", quantity: 3 }, ...lines.slice(1)], returns)).toBe(false);
    expect(fullyReturned(lines, [])).toBe(false);
    expect(fullyReturned([], returns)).toBe(false);
  });
});

describe("database refusals", () => {
  it("maps the messages a person can act on, and nothing technical", () => {
    expect(returnErrorKey("The day is closed")).toBe("returns.errDayClosed");
    expect(returnErrorKey("Cannot return more than was sold")).toBe("returns.errTooMany");
    expect(returnErrorKey("This sale is already voided")).toBe("returns.errVoided");
    expect(returnErrorKey("That refund method does not fit this sale")).toBe("returns.errMethod");
    expect(returnErrorKey("A note is required for this reason")).toBe("returns.errNoteRequired");
    expect(returnErrorKey("duplicate key value violates unique constraint")).toBeNull();
  });

  it("falls back to a translated message, never the server's text", () => {
    const t = (key: string) => key;
    expect(describeReturnError(new Error("boom"), t)).toBe("returns.errGeneric");
    expect(describeReturnError(new Error("Failed to fetch"), t)).toBe("errors.network");
    expect(describeReturnError(new Error("The day is closed"), t)).toBe("returns.errDayClosed");
    expect(describeReturnError(new Error("Only an owner can return items"), t)).toBe(
      "errors.permission"
    );
  });
});
