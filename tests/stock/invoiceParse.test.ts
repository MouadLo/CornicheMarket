import {
  isInvoiceExtraction,
  invoiceDiscount,
  invoiceMoneyCents,
  invoiceQuantity,
  invoiceVatPercent,
  priceBasisFromLabel,
  priceBasisFromTotals,
  normalizeInvoice,
  sameInvoiceHeader,
  totalTargets,
  matchedTotal,
  discountOff,
  type InvoiceExtraction,
} from "../../supabase/functions/_shared/invoiceParse";
import { sodaInvoice, waterReceipt } from "../fixtures/realInvoices";

it.each([
  ["1 216,00", 121600],
  ["216.00", 21600],
  ["1\u202f216,09 DH", 121609],
  ["١٬٢١٦٫٠٩ درهم", 121609],
  ["۱۲٫۵", 1250],
  ["0", 0],
  ["12.345", null],
  ["1,216", null],
  ["12 16,00", null],
  ["12 DH 34", null],
  ["-1", null],
])("reads the printed amount %s in integer centimes", (text, cents) => {
  expect(invoiceMoneyCents(text)).toBe(cents);
});

it("recognizes Arabic quantities and rejects more than three decimal places", () => {
  expect(invoiceQuantity("٣٫٢٥٠")).toBe(3.25);
  expect(invoiceQuantity("1.2345")).toBeNull();
});

const invoice: InvoiceExtraction = {
  supplier_name: null,
  invoice_number: null,
  invoice_date: null,
  subtotal_ht: "100",
  vat_total: "20",
  total_ttc: "120",
  lines: [
    {
      description: "Produit",
      billed_text: "2 pièces",
      quantity_billed: "2",
      billing_unit: "pièces",
      unit_price_text: "50",
      line_total_text: "99",
      vat_rate: "20%",
    },
  ],
};

it("allows a difference of exactly one dirham and compares merchandise to HT when VAT is printed", () => {
  expect(normalizeInvoice(invoice).flags).toEqual([]);
  const line = { ...invoice.lines[0], line_total_text: "98,99", quantity_billed: null };
  expect(normalizeInvoice({ ...invoice, lines: [line] }).flags).toEqual([
    "totals_mismatch",
    "unreadable_lines",
  ]);
});

it.each([
  ["Lait entier 1 L", null, "6", "8,50", "6", "8.50"],
  ["Lait entier 1 L", "pièce", "6", "8,50", "6", "8.50"],
  ["أرز ١ كغ", "قطعة", "٣", "١٢٫٥٠", "3", "12.50"],
  ["أرز ١ كغ", null, "٣", "١٢٫٥٠", "3", "12.50"],
])(
  "keeps quantity and unit cost for %s when the billing unit is %s",
  (description, billing_unit, quantity_billed, unit_price_text, quantity, unit_cost) => {
    const result = normalizeInvoice({
      ...invoice,
      lines: [{ ...invoice.lines[0], description, billing_unit, quantity_billed, unit_price_text }],
    });
    expect(result.sourceLines[0]).toMatchObject({ description, billing_unit, quantity, unit_cost });
    expect(result.flags).toEqual([]);
  }
);

it.each([
  ["Eau 1.5 L", "carton de 6"],
  ["Riz", "kg"],
])(
  "flags %s billed by %s and preserves the printed unit for review",
  (description, billing_unit) => {
    const result = normalizeInvoice({
      ...invoice,
      lines: [{ ...invoice.lines[0], description, billing_unit }],
    });
    expect(result.sourceLines[0]).toMatchObject({ billing_unit, quantity: "", unit_cost: "" });
    expect(result.flags).toEqual(["unit_check"]);
  }
);

it("keeps the printed billed quantity and cost so the review can convert a carton", () => {
  const result = normalizeInvoice({
    ...invoice,
    lines: [
      {
        ...invoice.lines[0],
        description: "Eau 1.5 L",
        billing_unit: "carton de 6",
        quantity_billed: "2",
        unit_price_text: "30,00",
      },
    ],
  });
  expect(result.sourceLines[0]).toMatchObject({
    billed_quantity: "2",
    billed_unit_cost: "30.00",
    quantity: "",
    unit_cost: "",
  });
});

it("recognizes the same normalized invoice number only for the same supplier", () => {
  const header = { supplier_id: "supplier", invoice_number: " AB-01 " };
  expect(sameInvoiceHeader(header, { ...header, invoice_number: "ab-01" })).toBe(true);
  expect(sameInvoiceHeader(header, { ...header, supplier_id: "other" })).toBe(false);
});

it.each([
  ["20%", 20],
  ["20 %", 20],
  ["٢٠٪", 20],
  ["10,00", 10],
  ["7", 7],
  ["0", 0],
  ["14.0", 14],
  ["20,5", null],
  ["101", null],
  ["vingt", null],
  ["", null],
  [null, null],
])("reads the TVA rate %j as %s", (text, rate) => {
  expect(invoiceVatPercent(text)).toBe(rate);
});

it.each([
  ["PU HT", "ht"],
  ["Prix unitaire H.T.", "ht"],
  ["Prix hors taxes", "ht"],
  ["PU TTC", "ttc"],
  ["Prix T.T.C", "ttc"],
  ["Prix toutes taxes comprises", "ttc"],
  ["السعر بدون ضريبة", "ht"],
  ["السعر شامل الضريبة", "ttc"],
  ["Prix", null],
  ["HT / TTC", null],
  [null, null],
])("reads the price column heading %j as %s", (label, basis) => {
  expect(priceBasisFromLabel(label)).toBe(basis);
});

describe("price basis from the totals", () => {
  const totals = { subtotal_ht: 10000, vat_total: 2000, total_ttc: 12000 };
  it("is HT when the lines add up to the HT subtotal", () => {
    expect(priceBasisFromTotals(10000, totals)).toBe("ht");
    expect(priceBasisFromTotals(10100, totals)).toBe("ht");
  });
  it("is TTC when the lines add up to the TTC total", () => {
    expect(priceBasisFromTotals(12000, totals)).toBe("ttc");
    expect(priceBasisFromTotals(11901, totals)).toBe("ttc");
  });
  it("is unknown when they match neither, or no totals are printed", () => {
    expect(priceBasisFromTotals(11000, totals)).toBeNull();
    expect(priceBasisFromTotals(null, totals)).toBeNull();
    expect(
      priceBasisFromTotals(10000, { subtotal_ht: null, vat_total: null, total_ttc: null })
    ).toBeNull();
  });
  it("is HT when there is no TVA at all, since HT and TTC are the same", () => {
    expect(priceBasisFromTotals(5000, { subtotal_ht: 5000, vat_total: 0, total_ttc: 5000 })).toBe(
      "ht"
    );
  });
});

describe("normalizeInvoice price basis and TVA", () => {
  const line = (unit: string, total: string, vat: string | null = "20%") => ({
    ...invoice.lines[0],
    billing_unit: null,
    quantity_billed: "2",
    unit_price_text: unit,
    line_total_text: total,
    vat_rate: vat,
  });
  const base = { ...invoice, subtotal_ht: "100,00", vat_total: "20,00", total_ttc: "120,00" };

  it("detects HT lines and keeps each line's rate", () => {
    const result = normalizeInvoice({
      ...base,
      lines: [line("30", "60"), line("20", "40", "10%")],
    });
    expect(result.totals).toMatchObject({ price_basis: "ht", vat_percent: null });
    expect(result.sourceLines.map((l) => l.vat_percent)).toEqual([20, 10]);
    expect(result.flags).toEqual([]);
  });

  it("detects TTC lines and does not call that a mismatch", () => {
    const result = normalizeInvoice({ ...base, lines: [line("36", "72"), line("24", "48")] });
    expect(result.totals.price_basis).toBe("ttc");
    expect(result.flags).toEqual([]);
  });

  it("lets the column heading decide, and refuses to guess when heading and totals disagree", () => {
    const ttcLines = [line("36", "72"), line("24", "48")];
    expect(
      normalizeInvoice({ ...base, price_basis_text: "PU TTC", lines: ttcLines }).totals.price_basis
    ).toBe("ttc");
    expect(
      normalizeInvoice({ ...base, price_basis_text: "PU HT", lines: ttcLines }).totals.price_basis
    ).toBeNull();
  });

  it("is unknown when nothing is printed to tell", () => {
    const result = normalizeInvoice({
      ...base,
      subtotal_ht: null,
      vat_total: null,
      total_ttc: null,
      lines: [line("30", "60")],
    });
    expect(result.totals.price_basis).toBeNull();
  });

  it("falls back to the invoice's single rate for a line without one", () => {
    const result = normalizeInvoice({ ...base, lines: [line("30", "60"), line("20", "40", null)] });
    expect(result.totals.vat_percent).toBe(20);
    expect(result.sourceLines.map((l) => l.vat_percent)).toEqual([20, 20]);
  });

  it("derives the rate from the printed VAT when no line prints one", () => {
    const result = normalizeInvoice({
      ...base,
      lines: [line("30", "60", null), line("20", "40", null)],
    });
    expect(result.totals.vat_percent).toBe(20);
  });

  it("leaves the rate empty when it cannot be known", () => {
    const result = normalizeInvoice({
      ...base,
      vat_total: null,
      lines: [line("30", "60", null), line("20", "40", null)],
    });
    expect(result.totals.vat_percent).toBeNull();
    expect(result.sourceLines.map((l) => l.vat_percent)).toEqual([null, null]);
  });

  it("still flags lines that add up to neither total", () => {
    expect(
      normalizeInvoice({ ...base, lines: [line("30", "60"), line("20", "99")] }).flags
    ).toContain("totals_mismatch");
  });
});

it("accepts an extraction saved before price_basis_text existed", () => {
  expect(isInvoiceExtraction(invoice)).toBe(true);
  expect(isInvoiceExtraction({ ...invoice, price_basis_text: "PU HT" })).toBe(true);
  expect(isInvoiceExtraction({ ...invoice, price_basis_text: 5 })).toBe(false);
});

it.each([
  ["10%", { percent: 10, cents: null }],
  ["-10 %", { percent: 10, cents: null }],
  ["7,5%", { percent: 7.5, cents: null }],
  ["٢٠٪", { percent: 20, cents: null }],
  ["5,00", { percent: null, cents: 500 }],
  ["- 12.50 DH", { percent: null, cents: 1250 }],
  ["0", null],
  ["0%", null],
  ["101%", null],
  ["", null],
  [null, null],
  ["remise spéciale", null],
])("reads the line discount %j as %j", (text, expected) => {
  expect(invoiceDiscount(text)).toEqual(expected);
});

describe("line discounts in normalizeInvoice", () => {
  const head = {
    supplier_name: "S",
    invoice_number: "1",
    invoice_date: "2026-11-01",
    subtotal_ht: null,
    vat_total: null,
    total_ttc: null,
  };
  const run = (discount_text: string | null) =>
    normalizeInvoice({
      ...head,
      lines: [
        {
          description: "Huile 5L",
          billed_text: null,
          quantity_billed: "10",
          billing_unit: null,
          unit_price_text: "100,00",
          line_total_text: "900,00",
          vat_rate: null,
          discount_text,
        },
      ],
    }).sourceLines[0];

  it("keeps the printed price, the discount as printed and the printed line total", () => {
    const result = run("10%");
    expect(result.billed_unit_cost).toBe("100.00");
    expect(result.discount_text).toBe("10%");
    expect(result.line_total).toBe("900.00");
  });

  it("no discount printed: none kept", () => {
    expect(run(null).discount_text).toBeNull();
  });
});

it("accepts lines saved before discount_text existed", () => {
  expect(isInvoiceExtraction(invoice)).toBe(true);
  const [first] = invoice.lines;
  expect(isInvoiceExtraction({ ...invoice, lines: [{ ...first, discount_text: 5 }] })).toBe(false);
});

it("accepts an extraction saved before the discount, stamp and net-to-pay keys existed", () => {
  expect(isInvoiceExtraction(invoice)).toBe(true);
  expect(
    isInvoiceExtraction({
      ...invoice,
      global_discount_text: "5%",
      stamp_duty_text: "1,48",
      net_to_pay_text: null,
    })
  ).toBe(true);
  expect(isInvoiceExtraction({ ...invoice, stamp_duty_text: 5 })).toBe(false);
});

describe("totals the lines can be checked against", () => {
  it("works the TTC out from HT + TVA, or net to pay less the stamp duty, when none is printed", () => {
    expect(
      totalTargets({
        subtotal_ht: 117669,
        vat_total: 23533,
        total_ttc: null,
        stamp_duty: 353,
        net_to_pay: 141555,
      })
    ).toEqual({ ht: 117669, ttc: [141202] });
  });

  it("accepts a TTC that already includes the stamp duty", () => {
    const targets = totalTargets({
      subtotal_ht: 49312,
      vat_total: 9862,
      total_ttc: 59322,
      stamp_duty: 148,
    });
    expect(targets.ttc).toContain(59174);
  });

  it("matches within 1 DH", () => {
    const totals = { subtotal_ht: 10000, vat_total: 2000, total_ttc: 12000 };
    expect(matchedTotal(10099, totals)).toEqual({ ht: true, ttc: false });
    expect(matchedTotal(11950, totals)).toEqual({ ht: false, ttc: true });
    expect(matchedTotal(null, totals)).toEqual({ ht: false, ttc: false });
  });

  it("takes a discount off a sum, refusing an amount larger than it", () => {
    expect(discountOff(155320, { percent: null, cents: 14118 })).toBe(14118);
    expect(discountOff(10000, { percent: 5, cents: null })).toBe(500);
    expect(discountOff(10000, { percent: null, cents: 10001 })).toBeNull();
  });
});

describe("real invoices", () => {
  it("water receipt: TTC prices, a discount on the whole invoice and a stamp duty agree with the totals", () => {
    const result = normalizeInvoice(waterReceipt);
    expect(result.flags).toEqual([]);
    expect(result.totals.price_basis).toBe("ttc");
    expect(result.totals.vat_percent).toBe(20);
    expect(result.totals).toMatchObject({
      subtotal_ht: 117669,
      total_ttc: null,
      stamp_duty: 353,
      net_to_pay: 141555,
      global_discount_text: "141,18",
    });
  });

  it("soda invoice: HT prices with trailing-minus line discounts agree with the net HT total", () => {
    const result = normalizeInvoice(sodaInvoice);
    expect(result.flags).toEqual([]);
    expect(result.totals.price_basis).toBe("ht");
    expect(result.totals.vat_percent).toBe(20);
    expect(result.sourceLines[0]).toMatchObject({
      billed_unit_cost: "50.50",
      discount_text: "24,24-",
      line_total: "379.76",
    });
    expect(invoiceDiscount("24,24-")).toEqual({ percent: null, cents: 2424 });
  });

  it("soda invoice: the printed total of line discounts misread as an invoice discount is no mismatch", () => {
    const result = normalizeInvoice({ ...sodaInvoice, global_discount_text: "37,06-" });
    expect(result.flags).toEqual([]);
    expect(result.totals.price_basis).toBe("ht");
  });

  it("soda invoice: a TTC read with the stamp duty in it is no mismatch", () => {
    expect(normalizeInvoice({ ...sodaInvoice, total_ttc: "593,22" }).flags).toEqual([]);
  });

  it("still flags lines that match no printed total", () => {
    expect(
      normalizeInvoice({ ...sodaInvoice, subtotal_ht: "450,00", total_ttc: "540,00" }).flags
    ).toContain("totals_mismatch");
  });
});
