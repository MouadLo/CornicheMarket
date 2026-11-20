// The receipt of a sale once some of its items were handed back: it lists only
// what the customer kept, with the new total. Pure; money in integer centimes,
// quantities (numeric(12,3)) handled in thousandths.
import type { ReceiptLine, ReceiptModel } from "@/src/lib/sales/receipt";
import type { SaleLine, SaleSummary } from "@/src/lib/sales/queries";
import {
  returnedByLine,
  totalRefundedCents,
  type RefundMethod,
  type SaleReturnRecord,
} from "@/src/lib/sales/returns";

const milli = (quantity: number) => Math.round(quantity * 1000);

// unit price (centimes) x quantity (thousandths) / 1000, rounded half up.
function priceTimesQuantityCents(unitPriceCents: number, quantityMilli: number): number {
  return Math.floor((unitPriceCents * quantityMilli + 500) / 1000);
}

export function receiptAfterReturns(
  base: ReceiptModel,
  sale: SaleSummary,
  lines: SaleLine[],
  returns: SaleReturnRecord[],
  unknownProductName: string
): ReceiptModel {
  const byLine = returnedByLine(returns);
  const kept: ReceiptLine[] = [];
  for (const line of lines) {
    const handedBack = byLine.get(line.id);
    const keptMilli = milli(line.quantity) - milli(handedBack?.quantity ?? 0);
    if (keptMilli <= 0) continue;
    const soldMilli = milli(line.quantity);
    // Without a sale-level discount a refund is exactly the kept part's price
    // taken off the line, so line total - refund is the kept amount to the
    // centime. With one, the refund also took that discount's share off, so
    // line total - refund would overstate the kept items (1 x 5.00 shown as
    // 5.50): the kept part of the line total is used instead, and the discount
    // row below carries what is left of the sale discount.
    const totalCents =
      sale.discount_cents === 0
        ? line.line_total_cents - (handedBack?.refundCents ?? 0)
        : Math.floor((2 * line.line_total_cents * keptMilli + soldMilli) / (2 * soldMilli));
    kept.push({
      name: line.product_name ?? unknownProductName,
      quantity: keptMilli / 1000,
      unit: line.unit,
      unitPriceCents: line.unit_price_cents,
      discountCents: Math.max(
        0,
        priceTimesQuantityCents(line.unit_price_cents, keptMilli) - totalCents
      ),
      totalCents,
    });
  }

  const refundedCents = totalRefundedCents(returns);
  const totalCents = sale.total_cents - refundedCents;
  // What is left of the sale-level discount: the kept lines' share of it, give
  // or take a centime of rounding per line. Rounding can leave it a centime
  // or two below zero; the largest kept line absorbs that so the receipt
  // still adds up (subtotal - discount = total) and never prints a negative
  // discount.
  let subtotalCents = kept.reduce((sum, line) => sum + line.totalCents, 0);
  const shortfall = totalCents - subtotalCents;
  if (shortfall > 0 && kept.length > 0) {
    const largest = kept.reduce((a, b) => (b.totalCents > a.totalCents ? b : a));
    largest.totalCents += shortfall;
    largest.discountCents = Math.max(
      0,
      priceTimesQuantityCents(largest.unitPriceCents, milli(largest.quantity)) - largest.totalCents
    );
    subtotalCents = totalCents;
  }
  const discountCents = Math.max(0, subtotalCents - totalCents);

  const refundMethods: RefundMethod[] = [];
  for (const record of returns) {
    if (!refundMethods.includes(record.refundMethod)) refundMethods.push(record.refundMethod);
  }
  const lastReturnAt = returns.reduce(
    (latest, record) => (record.createdAt > latest ? record.createdAt : latest),
    returns[0].createdAt
  );

  return {
    ...base,
    lines: kept,
    subtotalCents,
    discountCents,
    totalCents,
    afterReturns: {
      originalTotalCents: sale.total_cents,
      refundedCents,
      refundMethods,
      lastReturnAt,
    },
  };
}
