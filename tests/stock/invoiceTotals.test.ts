import {
  normalizeInvoice,
  type InvoiceExtraction,
} from "@/supabase/functions/_shared/invoiceParse";
import { lineTotalAgrees, confirmedSource, withPrinted } from "@/src/lib/stock/invoices";
import {
  costGlobalDiscount,
  defaultApplyGlobal,
  initialReview,
  invoiceSummary,
} from "@/src/lib/stock/invoiceTotals";
import { sodaInvoice, waterReceipt } from "../fixtures/realInvoices";

jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));

const draftOf = (extraction: InvoiceExtraction) => {
  const { sourceLines, totals } = normalizeInvoice(extraction);
  return { source_lines: sourceLines, totals };
};

describe("water receipt: TTC prices and a discount on the whole invoice", () => {
  const draft = draftOf(waterReceipt);
  const review = initialReview(draft, true);

  it("applies the discount, since the lines less it give the TTC worked out from HT + TVA", () => {
    expect(review.totals.applyGlobal).toBe(true);
    expect(review.basis.global).toEqual({ kind: "amount", cents: 14118, linesTotalCents: 155320 });
  });

  it("spreads it over every line cost: price × 1 412,02 / 1 553,20", () => {
    expect(review.lines.map((line) => line.unitCost)).toEqual(["18.55", "29.82", "25.09"]);
  });

  it("shows the lines matching the TTC, with no arithmetic warnings", () => {
    const summary = invoiceSummary(draft.source_lines, review.lines, review.totals, "ttc");
    expect(summary).toMatchObject({
      gross: 155320,
      lineDiscounts: 0,
      net: 155320,
      globalOff: 14118,
      linesTotal: 141202,
      globalIncluded: false,
      vatOff: false,
      netOff: false,
    });
    expect(summary.check).toEqual({ status: "match", basis: "ttc", printed: 141202, diff: 0 });
  });

  it("the owner can switch the discount off: the totals then differ by it", () => {
    const off = { ...review.totals, applyGlobal: false };
    const summary = invoiceSummary(draft.source_lines, review.lines, off, "ttc");
    expect(summary.check).toMatchObject({ status: "differs", diff: 14118 });
    expect(costGlobalDiscount(summary, off)).toBeNull();
  });
});

describe("soda invoice: HT prices with a discount on each line", () => {
  const draft = draftOf(sodaInvoice);
  const review = initialReview(draft, true);

  it("takes each line's discount off before TVA, then splits the pack of 12 read from the name", () => {
    expect(review.basis.printed).toBe("ht");
    // 47,47 HT = 56,964 TTC per pack of 12 = 4,75 a bottle; 56,68 HT = 68,016 TTC = 5,67
    expect(review.lines.map((line) => line.unitCost)).toEqual(["4.75", "5.67"]);
    expect(review.lines.map((line) => line.quantity)).toEqual(["96", "24"]);
    expect(review.lines[0]).toMatchObject({ unitsPer: "12", unitsFromName: true });
    expect(review.lines[0]).toMatchObject({
      billedQuantity: "8",
      price: "50.50",
      discount: "24,24-",
    });
  });

  it("adds the lines up to the printed net HT", () => {
    const summary = invoiceSummary(draft.source_lines, review.lines, review.totals, "ht");
    expect(summary).toMatchObject({
      gross: 52400,
      lineDiscounts: 3088,
      net: 49312,
      vatOff: false,
      netOff: false,
    });
    expect(summary.check).toEqual({ status: "match", basis: "ht", printed: 49312, diff: 0 });
  });

  it("each printed line total agrees with quantity × price − discount", () => {
    expect(draft.source_lines.map((source) => lineTotalAgrees(source))).toEqual([true, true]);
  });

  it("a misread price shows on its line and in the totals; correcting it fixes both", () => {
    const wrong = withPrinted(
      draft.source_lines[0],
      review.lines[0],
      { price: "60,60" },
      review.basis
    );
    expect(lineTotalAgrees(confirmedSource(draft.source_lines[0], wrong))).toBe(false);
    const lines = [wrong, review.lines[1]];
    expect(invoiceSummary(draft.source_lines, lines, review.totals, "ht").check.status).toBe(
      "differs"
    );
    const fixed = withPrinted(draft.source_lines[0], wrong, { price: "50,50" }, review.basis);
    expect(fixed.unitCost).toBe("4.75");
  });

  it("the printed total of line discounts, misread as an invoice discount, is not applied", () => {
    const misread = draftOf({ ...sodaInvoice, global_discount_text: "37,06-" });
    const start = initialReview(misread, true);
    expect(start.totals.applyGlobal).toBe(false);
    expect(start.basis.global).toBeNull();
    expect(start.lines.map((line) => line.unitCost)).toEqual(["4.75", "5.67"]);
    const summary = invoiceSummary(misread.source_lines, start.lines, start.totals, "ht");
    expect(summary.globalIncluded).toBe(true);
  });

  it("warns when the printed totals do not add up", () => {
    const summary = invoiceSummary(
      draft.source_lines,
      review.lines,
      { ...review.totals, subtotalHt: "400,00", netToPay: "600,00" },
      "ht"
    );
    expect(summary.vatOff).toBe(true);
    expect(summary.netOff).toBe(true);
  });
});

describe("the discount on the whole invoice", () => {
  const draft = draftOf(sodaInvoice);
  const review = initialReview(draft, true);
  const totalsWith = (globalDiscount: string) => ({ ...review.totals, globalDiscount });

  it("an unreadable discount is shown, never applied", () => {
    const summary = invoiceSummary(draft.source_lines, review.lines, totalsWith("spécial"), "ht");
    expect(summary.globalUnread).toBe(true);
    expect(summary.global).toBeNull();
  });

  it("an amount larger than the lines cannot apply", () => {
    const summary = invoiceSummary(draft.source_lines, review.lines, totalsWith("900,00"), "ht");
    expect(summary.globalUnread).toBe(true);
  });

  it("a percentage applies by default when nothing is printed to check it against", () => {
    const bare = {
      ...totalsWith("5%"),
      subtotalHt: "",
      vatTotal: "",
      totalTtc: "",
      stampDuty: "",
      netToPay: "",
    };
    expect(defaultApplyGlobal(draft.source_lines, review.lines, bare, "ht")).toBe(true);
    const summary = invoiceSummary(
      draft.source_lines,
      review.lines,
      { ...bare, applyGlobal: true },
      "ht"
    );
    expect(summary.check.status).toBe("unchecked");
    expect(costGlobalDiscount(summary, { ...bare, applyGlobal: true })).toEqual({
      kind: "percent",
      hundredths: 500,
    });
  });

  it("is not applied by default when the totals match neither with nor without it", () => {
    expect(
      defaultApplyGlobal(
        draft.source_lines,
        review.lines,
        { ...totalsWith("5%"), subtotalHt: "300,00" },
        "ht"
      )
    ).toBe(false);
  });
});

it("an older draft without printed prices keeps its lines as read and applies nothing", () => {
  const draft = {
    source_lines: [
      {
        description: "Lait",
        billed: "6 · 8,50",
        quantity: "6",
        unit: "piece" as const,
        unit_cost: "8.50",
      },
    ],
    totals: null,
  };
  const review = initialReview(draft, false);
  expect(review.lines[0]).toMatchObject({ quantity: "6", unitCost: "8.50" });
  expect(review.lines[0].price).toBeUndefined();
  expect(review.totals.applyGlobal).toBe(false);
});
