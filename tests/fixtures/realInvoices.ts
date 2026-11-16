// Two real supplier invoices from the shop, transcribed as the extractor should
// read them (product lines and totals only; no customer names or addresses).
import type { InvoiceExtraction } from "@/supabase/functions/_shared/invoiceParse";

const line = (
  description: string,
  quantity: string,
  price: string,
  total: string,
  discount: string | null = null
) => ({
  description,
  billed_text: null,
  quantity_billed: quantity,
  billing_unit: null,
  unit_price_text: price,
  line_total_text: total,
  vat_rate: null,
  discount_text: discount,
});

// A water bottler's till receipt: TTC prices with no heading, a TTC discount on
// the whole invoice, no TTC total printed (HT + TVA is 1 412,02), and a stamp
// duty added on top: 1 553,20 − 141,18 = 1 412,02 + 3,53 = 1 415,55.
export const waterReceipt: InvoiceExtraction = {
  supplier_name: "Les Eaux Minerales dOulmes SA",
  invoice_number: "F/ASB/0198857",
  invoice_date: "2024-12-23",
  price_basis_text: "Prix",
  subtotal_ht: "1176,69",
  vat_total: "235,33",
  total_ttc: null,
  global_discount_text: "141,18",
  stamp_duty_text: "3,53",
  net_to_pay_text: "1415,55",
  lines: [
    line("SIDI ALI PET 33CL", "11", "20,40", "224,40"),
    line("SIDI ALI 50CL", "22", "32,80", "721,60"),
    line("SIDI ALI PET 1.50L", "22", "27,60", "607,20"),
  ],
};

// A soft-drinks delivery note: HT prices, a discount amount per line printed
// with a trailing minus, net HT line totals, and a stamp duty on cash payment.
// It also prints "Total Remise permanente (TTC) 37,06-": only the line
// discounts again (30,88 HT × 1.2), never an extra discount.
export const sodaInvoice: InvoiceExtraction = {
  supplier_name: "Société Centrale des Boissons Gazeuses",
  invoice_number: "0877320664",
  invoice_date: "2025-01-03",
  price_basis_text: "Prix HT",
  subtotal_ht: "493,12",
  vat_total: "98,62",
  total_ttc: "591,74",
  global_discount_text: null,
  stamp_duty_text: "1,48",
  net_to_pay_text: "593,22",
  lines: [
    line("COCA-COLA PET 45*12", "8", "50,50", "379,76", "24,24-"),
    line("HAWAI TROPICAL PET 45*12", "2", "60,00", "113,36", "6,64-"),
  ],
};
