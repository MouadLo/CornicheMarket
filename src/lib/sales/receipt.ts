import { formatMAD } from "@/src/lib/money";
import type { PendingSale } from "@/src/lib/sales/offlineQueue";
import type { PaymentMethod, SaleLine, SaleSummary } from "@/src/lib/sales/queries";
import { lineTotal } from "@/src/lib/sales/totals";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { formatLocaleDateTime } from "@/src/lib/text/dates";

// A customer receipt. Built only from what the customer may see: there is no
// cost, margin or profit field here, and the builders below copy fields one by
// one so a cost carried by a cart line can never travel into the receipt.
// Every amount is integer centimes.

export const RECEIPT_SHOP_NAME = "Corniche Market";

export type ReceiptLine = {
  name: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
};

export type ReceiptModel = {
  shopName: string;
  receiptNumber: string;
  // ISO instant of the sale.
  occurredAt: string;
  cashierName: string | null;
  lines: ReceiptLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  customerName: string | null;
  // Only set when they were known at the moment of the sale.
  cashReceivedCents: number | null;
  changeCents: number | null;
};

export function receiptNumberOf(saleId: string): string {
  return saleId.slice(0, 8).toUpperCase();
}

function clean(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

// A sale just accepted on this device (confirmed or safely queued).
export function receiptFromPendingSale(
  sale: PendingSale,
  extra: {
    cashierName?: string | null;
    customerName?: string | null;
    cashReceivedCents?: number | null;
    changeCents?: number | null;
  } = {}
): ReceiptModel {
  const lines: ReceiptLine[] = sale.lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceCents: line.unit_price_cents,
    discountCents: line.discount_cents,
    totalCents: lineTotal(line),
  }));
  const known = sale.payment_method === "cash" && (extra.cashReceivedCents ?? null) !== null;
  return {
    shopName: RECEIPT_SHOP_NAME,
    receiptNumber: receiptNumberOf(sale.id),
    occurredAt: sale.created_at ?? new Date().toISOString(),
    cashierName: clean(extra.cashierName),
    lines,
    subtotalCents: sale.total_cents + sale.discount_cents,
    discountCents: sale.discount_cents,
    totalCents: sale.total_cents,
    paymentMethod: sale.payment_method,
    customerName: sale.payment_method === "credit" ? clean(extra.customerName) : null,
    cashReceivedCents: known ? (extra.cashReceivedCents ?? null) : null,
    changeCents: known ? (extra.changeCents ?? null) : null,
  };
}

// A sale read back from the history, with its lines. Stored totals are used as
// they are; cash received and change are not stored, so they are left out.
// A voided sale has no receipt.
export function receiptFromHistorySale(
  sale: SaleSummary,
  lines: SaleLine[],
  unknownProductName: string
): ReceiptModel | null {
  if (sale.voided_at) return null;
  return {
    shopName: RECEIPT_SHOP_NAME,
    receiptNumber: receiptNumberOf(sale.id),
    occurredAt: sale.occurred_at ?? sale.created_at,
    cashierName: clean(sale.cashier_name),
    lines: lines.map((line) => ({
      name: line.product_name ?? unknownProductName,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unit_price_cents,
      discountCents: line.discount_cents,
      totalCents: line.line_total_cents,
    })),
    subtotalCents: sale.total_cents + sale.discount_cents,
    discountCents: sale.discount_cents,
    totalCents: sale.total_cents,
    paymentMethod: sale.payment_method,
    customerName: sale.payment_method === "credit" ? clean(sale.customer_name) : null,
    cashReceivedCents: null,
    changeCents: null,
  };
}

// Whether the history can offer a receipt for this sale.
export function canOfferReceipt(sale: { voided_at: string | null }): boolean {
  return !sale.voided_at;
}

export type ReceiptLabels = {
  receipt: string; // heading
  number: string; // "No."
  cashier: string;
  customer: string;
  subtotal: string;
  discount: string;
  total: string;
  payment: string;
  paymentMethod: string; // already translated
  cashReceived: string;
  change: string;
  thanks: string;
  lineDiscount: (amount: string) => string;
  unit: (unit: string, quantity: number) => string;
};

export type ReceiptRenderOptions = { language: string; timeZone?: string };

// Quantities are numeric(12,3): at most three decimals, no trailing zeros.
export function formatReceiptQuantity(quantity: number): string {
  return String(Number(quantity.toFixed(3)));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function quantityText(line: ReceiptLine, labels: ReceiptLabels): string {
  const unit = line.unit ? labels.unit(line.unit, line.quantity) : "";
  return `${formatReceiptQuantity(line.quantity)} ${unit}`.trim();
}

export function receiptDateText(model: ReceiptModel, options: ReceiptRenderOptions): string {
  return formatLocaleDateTime(new Date(model.occurredAt), options.language, options.timeZone);
}

export function receiptToHtml(
  model: ReceiptModel,
  labels: ReceiptLabels,
  options: ReceiptRenderOptions
): string {
  const rtl = options.language === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const start = rtl ? "right" : "left";
  const end = rtl ? "left" : "right";
  // Amounts and numbers keep their left-to-right order inside Arabic lines.
  const num = (text: string) => escapeHtml(rtl ? isolateLtr(text) : text);
  const name = (text: string) => escapeHtml(isolateBidi(text));
  const row = (label: string, value: string, cls = "") =>
    `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="amt">${value}</td></tr>`;

  const lineRows = model.lines
    .map((line) => {
      const detail = `${num(quantityText(line, labels))} &times; ${num(formatMAD(line.unitPriceCents))}`;
      const discount =
        line.discountCents > 0
          ? `<div class="sub">${escapeHtml(labels.lineDiscount(rtl ? isolateLtr(formatMAD(line.discountCents)) : formatMAD(line.discountCents)))}</div>`
          : "";
      return `<tr class="item"><td><div class="name">${name(line.name)}</div><div class="sub">${detail}</div>${discount}</td><td class="amt">${num(formatMAD(line.totalCents))}</td></tr>`;
    })
    .join("");

  const meta: string[] = [
    `<div>${num(receiptDateText(model, options))}</div>`,
    `<div>${escapeHtml(labels.number)} ${num(model.receiptNumber)}</div>`,
  ];
  if (model.cashierName) {
    meta.push(`<div>${escapeHtml(labels.cashier)}: ${name(model.cashierName)}</div>`);
  }
  if (model.customerName) {
    meta.push(`<div>${escapeHtml(labels.customer)}: ${name(model.customerName)}</div>`);
  }

  const totals: string[] = [];
  if (model.discountCents > 0) {
    totals.push(row(labels.subtotal, num(formatMAD(model.subtotalCents))));
    totals.push(row(labels.discount, num(`-${formatMAD(model.discountCents)}`)));
  }
  totals.push(row(labels.total, num(formatMAD(model.totalCents)), "total"));
  totals.push(row(labels.payment, escapeHtml(labels.paymentMethod)));
  if (model.cashReceivedCents !== null && model.changeCents !== null) {
    totals.push(row(labels.cashReceived, num(formatMAD(model.cashReceivedCents))));
    totals.push(row(labels.change, num(formatMAD(model.changeCents))));
  }

  return `<!doctype html>
<html lang="${escapeHtml(options.language)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(model.shopName)} ${escapeHtml(model.receiptNumber)}</title>
<style>
  @page { margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #000; font-size: 12px; line-height: 1.35; }
  .receipt { width: 72mm; max-width: 100%; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 6px; }
  .meta { text-align: center; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; text-align: ${start}; }
  td.amt { text-align: ${end}; white-space: nowrap; padding-${rtl ? "right" : "left"}: 6px; }
  .items { border-top: 1px dashed #000; border-bottom: 1px dashed #000; margin: 6px 0; }
  .name { font-weight: 600; }
  .sub { font-size: 11px; }
  tr.total td { font-size: 15px; font-weight: 700; border-top: 1px solid #000; padding-top: 5px; }
  .thanks { text-align: center; margin-top: 10px; }
</style>
</head>
<body>
<div class="receipt">
<h1>${escapeHtml(model.shopName)}</h1>
<div class="meta">${meta.join("")}</div>
<table class="items"><tbody>${lineRows}</tbody></table>
<table><tbody>${totals.join("")}</tbody></table>
<div class="thanks">${escapeHtml(labels.thanks)}</div>
</div>
</body>
</html>`;
}

// Plain text for the web share sheet.
export function receiptToText(
  model: ReceiptModel,
  labels: ReceiptLabels,
  options: ReceiptRenderOptions
): string {
  const out: string[] = [
    model.shopName,
    receiptDateText(model, options),
    `${labels.number} ${model.receiptNumber}`,
  ];
  if (model.cashierName) out.push(`${labels.cashier}: ${model.cashierName}`);
  if (model.customerName) out.push(`${labels.customer}: ${model.customerName}`);
  out.push("");
  for (const line of model.lines) {
    out.push(line.name);
    out.push(
      `  ${quantityText(line, labels)} x ${formatMAD(line.unitPriceCents)}  ${formatMAD(line.totalCents)}`
    );
    if (line.discountCents > 0) out.push(`  ${labels.lineDiscount(formatMAD(line.discountCents))}`);
  }
  out.push("");
  if (model.discountCents > 0) {
    out.push(`${labels.subtotal}: ${formatMAD(model.subtotalCents)}`);
    out.push(`${labels.discount}: -${formatMAD(model.discountCents)}`);
  }
  out.push(`${labels.total}: ${formatMAD(model.totalCents)}`);
  out.push(`${labels.payment}: ${labels.paymentMethod}`);
  if (model.cashReceivedCents !== null && model.changeCents !== null) {
    out.push(`${labels.cashReceived}: ${formatMAD(model.cashReceivedCents)}`);
    out.push(`${labels.change}: ${formatMAD(model.changeCents)}`);
  }
  out.push("", labels.thanks);
  return out.join("\n");
}
