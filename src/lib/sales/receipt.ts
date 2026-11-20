import { formatMAD } from "@/src/lib/money";
import type { PendingSale } from "@/src/lib/sales/offlineQueue";
import type { PaymentMethod, SaleLine, SaleSummary } from "@/src/lib/sales/queries";
import { receiptAfterReturns } from "@/src/lib/sales/receiptAfterReturns";
import type { RefundMethod, SaleReturnRecord } from "@/src/lib/sales/returns";
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

// The loyalty part of a receipt, from what the device knew when it rang the sale.
// discountCents is the part of the sale's discount paid with points. Earned and
// balance are null when unknown (a history receipt, or a member attached
// offline); pending means the points are added when the sale syncs.
export type ReceiptLoyalty = {
  discountCents: number;
  pointsEarned: number | null;
  balanceAfterPoints: number | null;
  balanceAfterValueCents: number | null;
  pending: boolean;
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
  // Set when items of the sale were returned: the receipt then lists only what the customer kept.
  afterReturns?: {
    originalTotalCents: number; // the sale's total before any return
    refundedCents: number; // sum of every return's refund
    refundMethods: RefundMethod[]; // distinct, in order of first use
    lastReturnAt: string; // ISO instant of the latest return
  } | null;
  // Present only for a sale with a loyalty member (or one paid partly in points).
  loyalty?: ReceiptLoyalty | null;
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
    loyalty?: ReceiptLoyalty | null;
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
    ...(extra.loyalty ? { loyalty: loyaltyOnReceipt(extra.loyalty, sale.discount_cents) } : {}),
  };
}

// The loyalty discount can never be more than the discount it is part of.
function loyaltyOnReceipt(loyalty: ReceiptLoyalty, discountCents: number): ReceiptLoyalty {
  return { ...loyalty, discountCents: Math.min(Math.max(0, loyalty.discountCents), discountCents) };
}

// A sale read back from the history, with its lines. Stored totals are used as
// they are; cash received and change are not stored, so they are left out.
// A voided sale has no receipt.
export function receiptFromHistorySale(
  sale: SaleSummary,
  lines: SaleLine[],
  unknownProductName: string,
  returns: SaleReturnRecord[] = []
): ReceiptModel | null {
  if (sale.voided_at) return null;
  const base: ReceiptModel = {
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
  if (returns.length > 0)
    return receiptAfterReturns(base, sale, lines, returns, unknownProductName);
  // What the history knows of loyalty is the points part of the discount; what
  // was earned and the balance were not stored on the sale, so they are left out.
  // (After a return the discount is re-split between the kept lines, so the
  // points part is no longer a figure of the receipt.)
  const pointsDiscount = Math.min(sale.loyalty_discount_cents ?? 0, sale.discount_cents);
  return pointsDiscount > 0
    ? {
        ...base,
        loyalty: {
          discountCents: pointsDiscount,
          pointsEarned: null,
          balanceAfterPoints: null,
          balanceAfterValueCents: null,
          pending: false,
        },
      }
    : base;
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
  updatedAfterReturn: string;
  returnedOn: (date: string) => string;
  originalTotal: string;
  refunded: string;
  refundMethod: (method: RefundMethod) => string;
  allReturned: string;
  lineDiscount: (amount: string) => string;
  // Loyalty (shown only on a sale with a member).
  loyaltyDiscount: string; // "Loyalty discount"
  pointsEarned: (points: string) => string; // "Points earned +12"
  loyaltyBalance: (value: string, points: string) => string; // "Balance 3.40 DH (34 points)"
  loyaltyPending: string; // "Points added when synced"
  unit: (unit: string, quantity: number) => string;
};

export type ReceiptRenderOptions = {
  language: string;
  timeZone?: string;
  // Large box at the top (the shared printer prints the cashier's name there,
  // so each paper reaches the right customer). HTML only.
  banner?: string;
  // "80mm": size the page for a thermal roll. HTML only.
  paper?: "80mm";
};

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

// "Total initial" / "Remboursé" lines shown after the total of an updated receipt.
export function refundMethodsText(
  model: ReceiptModel,
  labels: ReceiptLabels,
  separator = " / "
): string {
  return (model.afterReturns?.refundMethods ?? []).map(labels.refundMethod).join(separator);
}

export function returnDateText(model: ReceiptModel, options: ReceiptRenderOptions): string {
  return formatLocaleDateTime(
    new Date(model.afterReturns?.lastReturnAt ?? model.occurredAt),
    options.language,
    options.timeZone
  );
}

// The discount split the way the customer paid it: what the cashier took off,
// and what the points paid. They add up to the discount.
export function discountSplit(model: ReceiptModel): { manualCents: number; pointsCents: number } {
  const pointsCents = Math.min(model.loyalty?.discountCents ?? 0, model.discountCents);
  return { manualCents: model.discountCents - pointsCents, pointsCents };
}

// Lines under the totals: points earned, balance, or the pending note. Plain
// strings; each renderer escapes and isolates its own way.
export function loyaltyFooterLines(
  model: ReceiptModel,
  labels: ReceiptLabels,
  wrap: (text: string) => string = (text) => text
): string[] {
  const loyalty = model.loyalty;
  if (!loyalty) return [];
  const out: string[] = [];
  if (loyalty.pointsEarned !== null && loyalty.pointsEarned > 0) {
    out.push(labels.pointsEarned(wrap(`+${loyalty.pointsEarned}`)));
  }
  if (loyalty.balanceAfterPoints !== null && loyalty.balanceAfterValueCents !== null) {
    out.push(
      labels.loyaltyBalance(
        wrap(formatMAD(loyalty.balanceAfterValueCents)),
        wrap(String(loyalty.balanceAfterPoints))
      )
    );
  } else if (loyalty.pending) {
    out.push(labels.loyaltyPending);
  }
  return out;
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

  const allReturned = !!model.afterReturns && model.lines.length === 0;
  const meta: string[] = [
    `<div>${num(receiptDateText(model, options))}</div>`,
    `<div>${escapeHtml(labels.number)} ${num(model.receiptNumber)}</div>`,
  ];
  if (model.afterReturns) {
    meta.push(`<div><strong>${escapeHtml(labels.updatedAfterReturn)}</strong></div>`);
    meta.push(
      `<div>${escapeHtml(labels.returnedOn(rtl ? isolateLtr(returnDateText(model, options)) : returnDateText(model, options)))}</div>`
    );
  }
  if (model.cashierName) {
    meta.push(`<div>${escapeHtml(labels.cashier)}: ${name(model.cashierName)}</div>`);
  }
  if (model.customerName) {
    meta.push(`<div>${escapeHtml(labels.customer)}: ${name(model.customerName)}</div>`);
  }

  const totals: string[] = [];
  if (model.discountCents > 0) {
    const split = discountSplit(model);
    totals.push(row(labels.subtotal, num(formatMAD(model.subtotalCents))));
    if (split.manualCents > 0) {
      totals.push(row(labels.discount, num(`-${formatMAD(split.manualCents)}`)));
    }
    if (split.pointsCents > 0) {
      totals.push(row(labels.loyaltyDiscount, num(`-${formatMAD(split.pointsCents)}`)));
    }
  }
  totals.push(row(labels.total, num(formatMAD(model.totalCents)), "total"));
  if (model.afterReturns) {
    totals.push(row(labels.originalTotal, num(formatMAD(model.afterReturns.originalTotalCents))));
    totals.push(
      row(
        `${labels.refunded} (${refundMethodsText(model, labels)})`,
        num(`-${formatMAD(model.afterReturns.refundedCents)}`)
      )
    );
  }
  totals.push(row(labels.payment, escapeHtml(labels.paymentMethod)));
  if (model.cashReceivedCents !== null && model.changeCents !== null) {
    totals.push(row(labels.cashReceived, num(formatMAD(model.cashReceivedCents))));
    totals.push(row(labels.change, num(formatMAD(model.changeCents))));
  }
  const loyaltyNotes = loyaltyFooterLines(model, labels, (text) => (rtl ? isolateLtr(text) : text))
    .map((line) => `<div class="loyalty">${escapeHtml(line)}</div>`)
    .join("");

  const banner = options.banner?.trim()
    ? `<div class="banner">${name(options.banner.trim())}</div>\n`
    : "";
  const page =
    options.paper === "80mm" ? "@page { size: 80mm auto; margin: 4mm; }" : "@page { margin: 4mm; }";

  return `<!doctype html>
<html lang="${escapeHtml(options.language)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(model.shopName)} ${escapeHtml(model.receiptNumber)}</title>
<style>
  ${page}
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
  .loyalty { margin-top: 4px; }
  .thanks { text-align: center; margin-top: 10px; }${
    banner
      ? "\n  .banner { font-size: 22px; font-weight: 700; text-align: center; border: 3px solid #000; padding: 6px 4px; margin: 0 0 8px; overflow-wrap: anywhere; }"
      : ""
  }
</style>
</head>
<body>
<div class="receipt">
${banner}<h1>${escapeHtml(model.shopName)}</h1>
<div class="meta">${meta.join("")}</div>
<table class="items"><tbody>${lineRows}</tbody></table>${allReturned ? `<div class="meta">${escapeHtml(labels.allReturned)}</div>` : ""}
<table><tbody>${totals.join("")}</tbody></table>${loyaltyNotes}
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
  if (model.afterReturns) {
    out.push(labels.updatedAfterReturn);
    out.push(labels.returnedOn(returnDateText(model, options)));
  }
  if (model.cashierName) out.push(`${labels.cashier}: ${model.cashierName}`);
  if (model.customerName) out.push(`${labels.customer}: ${model.customerName}`);
  out.push("");
  if (model.afterReturns && model.lines.length === 0) out.push(labels.allReturned);
  for (const line of model.lines) {
    out.push(line.name);
    out.push(
      `  ${quantityText(line, labels)} x ${formatMAD(line.unitPriceCents)}  ${formatMAD(line.totalCents)}`
    );
    if (line.discountCents > 0) out.push(`  ${labels.lineDiscount(formatMAD(line.discountCents))}`);
  }
  out.push("");
  if (model.discountCents > 0) {
    const split = discountSplit(model);
    out.push(`${labels.subtotal}: ${formatMAD(model.subtotalCents)}`);
    if (split.manualCents > 0) out.push(`${labels.discount}: -${formatMAD(split.manualCents)}`);
    if (split.pointsCents > 0) {
      out.push(`${labels.loyaltyDiscount}: -${formatMAD(split.pointsCents)}`);
    }
  }
  out.push(`${labels.total}: ${formatMAD(model.totalCents)}`);
  if (model.afterReturns) {
    out.push(`${labels.originalTotal}: ${formatMAD(model.afterReturns.originalTotalCents)}`);
    out.push(
      `${labels.refunded} (${refundMethodsText(model, labels)}): -${formatMAD(model.afterReturns.refundedCents)}`
    );
  }
  out.push(`${labels.payment}: ${labels.paymentMethod}`);
  if (model.cashReceivedCents !== null && model.changeCents !== null) {
    out.push(`${labels.cashReceived}: ${formatMAD(model.cashReceivedCents)}`);
    out.push(`${labels.change}: ${formatMAD(model.changeCents)}`);
  }
  out.push(...loyaltyFooterLines(model, labels));
  out.push("", labels.thanks);
  return out.join("\n");
}
