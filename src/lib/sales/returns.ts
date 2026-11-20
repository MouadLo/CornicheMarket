// Item returns (migration 046): hand back some items of a sale. Pure helpers
// shared by the return sheet and the history; the database recomputes every
// amount and is the authority, these only preview what it will do. Money stays
// in integer centimes; quantities are numeric(12,3), so they are handled in
// thousandths (integers) wherever they are compared or multiplied.
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { parseQuantity } from "@/src/lib/money";

export const RETURN_REASONS = ["wrong_item", "damaged", "customer_changed_mind", "other"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export type RefundMethod = "cash" | "card" | "credit";
export type SalePaymentMethod = "cash" | "card" | "credit";

const REASON_KEY: Record<ReturnReason, string> = {
  wrong_item: "returns.reasonWrongItem",
  damaged: "returns.reasonDamaged",
  customer_changed_mind: "returns.reasonChangedMind",
  other: "returns.reasonOther",
};
export function returnReasonKey(code: ReturnReason): string {
  return REASON_KEY[code];
}

// "Other" must say why, like a void.
export function returnReasonValid(reason: ReturnReason | null, note: string): boolean {
  if (!reason) return false;
  return reason !== "other" || note.trim().length > 0;
}

const METHOD_KEY: Record<RefundMethod, string> = {
  cash: "returns.refundCash",
  card: "returns.refundCard",
  credit: "returns.refundCredit",
};
export function refundMethodKey(method: RefundMethod): string {
  return METHOD_KEY[method];
}

// A credit sale is repaid on the customer's account (it lowers the debt, no
// cash goes out); a cash or card sale is refunded in cash or card.
export function refundMethodsFor(payment: SalePaymentMethod): RefundMethod[] {
  return payment === "credit" ? ["credit"] : ["cash", "card"];
}

// The sale's own method is what the customer expects back.
export function defaultRefundMethod(payment: SalePaymentMethod): RefundMethod {
  return payment === "credit" ? "credit" : payment;
}

// What the server says about one line of the sale (returnable_sale_lines).
// paidCents is what the customer paid for the WHOLE line: the line total after
// its discount and after its share of the sale discount.
export type ReturnableLine = {
  saleItemId: string;
  quantity: number;
  returnedQuantity: number;
  paidCents: number;
  refundedCents: number;
};

const milli = (quantity: number) => Math.round(quantity * 1000);

// What can still be handed back on the line, in the line's own unit.
export function remainingQuantity(line: ReturnableLine): number {
  return Math.max(0, milli(line.quantity) - milli(line.returnedQuantity)) / 1000;
}

// Refund for handing back `quantity` more of the line. The rounding rule is the
// database's (record_sale_return): with P paid for the line, Q sold, R already
// returned and F already refunded,
//     refund = round(P * (R + q) / Q) - F       (round half up, to the centime)
// and when R + q = Q it is exactly P - F. The refunds of one line therefore add
// up to P and never above it: the last unit takes the remainder.
export function refundForQuantityCents(line: ReturnableLine, quantity: number): number {
  const sold = milli(line.quantity);
  const already = milli(line.returnedQuantity);
  const now = milli(quantity);
  if (sold <= 0 || now <= 0 || now > sold - already) return 0;

  const room = line.paidCents - line.refundedCents;
  if (already + now === sold) return Math.max(0, room);

  const cumulative = Math.floor((2 * line.paidCents * (already + now) + sold) / (2 * sold));
  return Math.max(0, Math.min(cumulative - line.refundedCents, room));
}

// Text typed in a quantity box -> a quantity between 0 and what remains,
// to the gram. Anything unreadable is 0.
export function parseReturnQuantity(raw: string, remaining: number): number {
  const value = parseQuantity(raw);
  if (value === null || value <= 0) return 0;
  return Math.min(value, remaining);
}

export type ReturnSelection = Record<string, number>;

export type ReturnItem = { saleItemId: string; quantity: number; refundCents: number };
export type ReturnSummary = { items: ReturnItem[]; totalCents: number };

// The lines picked (quantity > 0) with their refunds, and the total.
export function summarizeReturn(
  lines: ReturnableLine[],
  selection: ReturnSelection
): ReturnSummary {
  const items: ReturnItem[] = [];
  let totalCents = 0;
  for (const line of lines) {
    const picked = Math.min(selection[line.saleItemId] ?? 0, remainingQuantity(line));
    if (picked <= 0) continue;
    const refundCents = refundForQuantityCents(line, picked);
    items.push({ saleItemId: line.saleItemId, quantity: picked, refundCents });
    totalCents += refundCents;
  }
  return { items, totalCents };
}

export function returnItemsPayload(
  summary: ReturnSummary
): { sale_item_id: string; quantity: number }[] {
  return summary.items.map((item) => ({ sale_item_id: item.saleItemId, quantity: item.quantity }));
}

// One recorded return, as the history reads it back. Cost is never in it.
export type SaleReturnRecord = {
  id: string;
  saleId: string;
  createdAt: string;
  reasonCode: ReturnReason;
  note: string | null;
  refundMethod: RefundMethod;
  refundCents: number;
  items: { saleItemId: string; quantity: number; refundCents: number }[];
};

// What was handed back per sale line, across every return of the sale.
export function returnedByLine(
  returns: SaleReturnRecord[]
): Map<string, { quantity: number; refundCents: number }> {
  const byLine = new Map<string, { quantity: number; refundCents: number }>();
  for (const record of returns) {
    for (const item of record.items) {
      const entry = byLine.get(item.saleItemId) ?? { quantity: 0, refundCents: 0 };
      entry.quantity = (milli(entry.quantity) + milli(item.quantity)) / 1000;
      entry.refundCents += item.refundCents;
      byLine.set(item.saleItemId, entry);
    }
  }
  return byLine;
}

export function totalRefundedCents(returns: SaleReturnRecord[]): number {
  return returns.reduce((sum, record) => sum + record.refundCents, 0);
}

// What the sale came to once the returns are taken off.
export function netAfterReturnsCents(totalCents: number, returns: SaleReturnRecord[]): number {
  return totalCents - totalRefundedCents(returns);
}

// How many units/lines were handed back, for the badge on a sale.
export function returnedLineCount(returns: SaleReturnRecord[]): number {
  return returnedByLine(returns).size;
}

// True when every line of the sale has been handed back in full.
export function fullyReturned(
  lines: { id: string; quantity: number }[],
  returns: SaleReturnRecord[]
): boolean {
  if (lines.length === 0) return false;
  const byLine = returnedByLine(returns);
  return lines.every((line) => milli(byLine.get(line.id)?.quantity ?? 0) >= milli(line.quantity));
}

type T = (key: string, options?: Record<string, unknown>) => string;

// Database message -> translation key, for the refusals a person can act on.
export function returnErrorKey(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("day is closed")) return "returns.errDayClosed";
  if (m.includes("more than was sold")) return "returns.errTooMany";
  if (m.includes("already voided")) return "returns.errVoided";
  if (m.includes("does not fit this sale")) return "returns.errMethod";
  if (m.includes("note is required")) return "returns.errNoteRequired";
  return null;
}

export function describeReturnError(error: unknown, t: T): string {
  const message = error instanceof Error ? error.message : "";
  return t(returnErrorKey(message) ?? errorKeyOr(error, "returns.errGeneric"));
}
