import {
  invoiceMoneyCents,
  invoiceQuantity,
  normalizeInvoice,
  sameInvoiceHeader,
  type InvoiceExtraction,
} from "../../supabase/functions/_shared/invoiceParse";

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
      pack_wording: "pièces",
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

it("keeps billed cartons visible without proposing them as pieces", () => {
  const result = normalizeInvoice({
    ...invoice,
    lines: [{ ...invoice.lines[0], pack_wording: "cartons" }],
  });
  expect(result.sourceLines[0]).toMatchObject({ quantity: "", unit_cost: "", unit: "piece" });
  expect(result.sourceLines[0].billed).toContain("cartons");
});

it("recognizes the same normalized invoice number only for the same supplier", () => {
  const header = { supplier_id: "supplier", invoice_number: " AB-01 " };
  expect(sameInvoiceHeader(header, { ...header, invoice_number: "ab-01" })).toBe(true);
  expect(sameInvoiceHeader(header, { ...header, supplier_id: "other" })).toBe(false);
});
