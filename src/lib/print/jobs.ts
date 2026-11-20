import type { ReceiptLine, ReceiptLoyalty, ReceiptModel } from "@/src/lib/sales/receipt";
import type { RefundMethod } from "@/src/lib/sales/returns";

// Pure helpers for the shared shop printer. A print job carries the receipt as
// DATA (a ReceiptModel in JSON), never HTML. The station validates it strictly
// before rendering it with its own code.

export type PrintJobStatus = "pending" | "printing" | "printed" | "failed" | "cancelled";
export type PrintLanguage = "fr" | "en" | "ar";

export type PrintJob = {
  id: string;
  created_by: string;
  cashier_label: string;
  receipt: unknown;
  language: PrintLanguage;
  time_zone: string | null;
  status: PrintJobStatus;
  created_at: string;
  claimed_at: string | null;
  printed_at: string | null;
  error: string | null;
  attempts: number;
};

export const MAX_RECEIPT_LINES = 200;
// A pending job older than this is not printed on its own: the cashier has
// long since handed over the sale.
export const STALE_AFTER_MS = 2 * 60 * 1000;
export const INVALID_RECEIPT_ERROR = "invalid receipt";

const MAX_TEXT = 200;
const MAX_CENTS = 100_000_000_000; // 1 billion DH: far beyond any sale
const MAX_QUANTITY = 1_000_000;
const MAX_POINTS = 1_000_000_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === "string" && value.length <= max;
}
function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}
function cents(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CENTS;
}
function nullableCents(value: unknown): value is number | null {
  return value === null || cents(value);
}
// numeric(12,3): at most three decimals.
function quantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_QUANTITY &&
    Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6
  );
}

function parseLine(value: unknown): ReceiptLine | null {
  if (!isObject(value)) return null;
  const { name, quantity: qty, unit, unitPriceCents, discountCents, totalCents } = value;
  if (!text(name) || !quantity(qty) || !nullableText(unit)) return null;
  if (!cents(unitPriceCents) || !cents(discountCents) || !cents(totalCents)) return null;
  return {
    name,
    quantity: qty,
    unit,
    unitPriceCents,
    discountCents,
    totalCents,
  };
}

const REFUND_METHODS: readonly RefundMethod[] = ["cash", "card", "credit"];

// The "after returns" footer of an updated receipt. Absent or null means a
// plain receipt; anything present but malformed makes the whole job invalid.
function parseAfterReturns(value: unknown): NonNullable<ReceiptModel["afterReturns"]> | null {
  if (!isObject(value)) return null;
  const { originalTotalCents, refundedCents, refundMethods, lastReturnAt } = value;
  if (!cents(originalTotalCents) || !cents(refundedCents)) return null;
  if (refundedCents > originalTotalCents) return null;
  if (!text(lastReturnAt, 40) || Number.isNaN(new Date(lastReturnAt).getTime())) return null;
  if (!Array.isArray(refundMethods) || refundMethods.length > REFUND_METHODS.length) return null;
  const methods: RefundMethod[] = [];
  for (const method of refundMethods) {
    if (!REFUND_METHODS.includes(method as RefundMethod)) return null;
    if (methods.includes(method as RefundMethod)) return null;
    methods.push(method as RefundMethod);
  }
  return { originalTotalCents, refundedCents, refundMethods: methods, lastReturnAt };
}

function points(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_POINTS;
}
function nullablePoints(value: unknown): value is number | null {
  return value === null || points(value);
}

// The loyalty block of a receipt. Absent or null means a plain receipt; anything
// present but malformed makes the whole job invalid. The points discount is part
// of the receipt's discount, so it can never be more than it.
function parseLoyalty(value: unknown, receiptDiscountCents: number): ReceiptLoyalty | null {
  if (!isObject(value)) return null;
  const { discountCents, pointsEarned, balanceAfterPoints, balanceAfterValueCents, pending } =
    value;
  if (!cents(discountCents) || discountCents > receiptDiscountCents) return null;
  if (!nullablePoints(pointsEarned) || !nullablePoints(balanceAfterPoints)) return null;
  if (!nullableCents(balanceAfterValueCents)) return null;
  // A balance is a pair: points and what they are worth, or neither.
  if ((balanceAfterPoints === null) !== (balanceAfterValueCents === null)) return null;
  if (typeof pending !== "boolean") return null;
  return { discountCents, pointsEarned, balanceAfterPoints, balanceAfterValueCents, pending };
}

// Copies the known fields one by one: anything else in the JSON is dropped.
export function parseReceiptJob(json: unknown): ReceiptModel | null {
  if (!isObject(json)) return null;
  const v = json;
  if (!text(v.shopName, 80) || !text(v.receiptNumber, 40) || !text(v.occurredAt, 40)) return null;
  if (Number.isNaN(new Date(v.occurredAt).getTime())) return null;
  if (!nullableText(v.cashierName) || !nullableText(v.customerName)) return null;
  if (!Array.isArray(v.lines) || v.lines.length > MAX_RECEIPT_LINES) return null;
  if (!cents(v.subtotalCents) || !cents(v.discountCents) || !cents(v.totalCents)) return null;
  if (v.paymentMethod !== "cash" && v.paymentMethod !== "card" && v.paymentMethod !== "credit") {
    return null;
  }
  if (!nullableCents(v.cashReceivedCents) || !nullableCents(v.changeCents)) return null;

  const lines: ReceiptLine[] = [];
  for (const raw of v.lines) {
    const line = parseLine(raw);
    if (!line) return null;
    lines.push(line);
  }
  let afterReturns: ReceiptModel["afterReturns"];
  if (v.afterReturns !== undefined && v.afterReturns !== null) {
    afterReturns = parseAfterReturns(v.afterReturns);
    if (!afterReturns) return null;
  }
  let loyalty: ReceiptModel["loyalty"];
  if (v.loyalty !== undefined && v.loyalty !== null) {
    loyalty = parseLoyalty(v.loyalty, v.discountCents);
    if (!loyalty) return null;
  }
  const model: ReceiptModel = {
    shopName: v.shopName,
    receiptNumber: v.receiptNumber,
    occurredAt: v.occurredAt,
    cashierName: v.cashierName,
    lines,
    subtotalCents: v.subtotalCents,
    discountCents: v.discountCents,
    totalCents: v.totalCents,
    paymentMethod: v.paymentMethod,
    customerName: v.customerName,
    cashReceivedCents: v.cashReceivedCents,
    changeCents: v.changeCents,
  };
  if (afterReturns) model.afterReturns = afterReturns;
  if (loyalty) model.loyalty = loyalty;
  return model;
}

export function isStale(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > STALE_AFTER_MS;
}

// A job the station list offers "Imprimer" / "Ignorer" for.
export function needsManualAction(job: Pick<PrintJob, "status" | "created_at">, now: number) {
  return job.status === "failed" || (job.status === "pending" && isStale(job.created_at, now));
}

export function normalizeLanguage(language: string | undefined): PrintLanguage {
  const base = (language ?? "fr").slice(0, 2);
  return base === "en" || base === "ar" ? base : "fr";
}

export function cashierLabelFor(
  fullName: string | null | undefined,
  receiptCashier: string | null | undefined
): string {
  const pick = fullName?.trim() || receiptCashier?.trim() || "Caisse";
  return pick.slice(0, 60);
}

// --- phone side --------------------------------------------------------------

export type PhonePrintState =
  "idle" | "sending" | "queued" | "printing" | "printed" | "failed" | "timeout" | "offline";

export const PHONE_POLL_MS = 1000;
export const PHONE_TIMEOUT_MS = 20_000;
export const STATION_CHECK_MS = 10_000;

// What the phone shows for a job status read from the server.
export function phoneStateOf(status: PrintJobStatus): PhonePrintState {
  switch (status) {
    case "pending":
      return "queued";
    case "printing":
      return "printing";
    case "printed":
      return "printed";
    case "failed":
    case "cancelled":
      return "failed";
  }
}

export function isPhoneFinal(state: PhonePrintState): boolean {
  return state === "printed" || state === "failed" || state === "timeout" || state === "offline";
}

// --- station list ------------------------------------------------------------

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Printed today (this PC's day) and the last print time, from the recent list.
export function stationStats(
  jobs: Pick<PrintJob, "status" | "printed_at">[],
  now: Date = new Date()
): { printedToday: number; lastPrintedAt: string | null } {
  let printedToday = 0;
  let last: string | null = null;
  for (const job of jobs) {
    if (job.status !== "printed" || !job.printed_at) continue;
    if (sameLocalDay(new Date(job.printed_at), now)) printedToday += 1;
    if (!last || job.printed_at > last) last = job.printed_at;
  }
  return { printedToday, lastPrintedAt: last };
}

// The receipt number shown in the list, whatever the stored JSON looks like.
export function jobReceiptNumber(job: Pick<PrintJob, "receipt">): string {
  const receipt = job.receipt;
  if (typeof receipt === "object" && receipt !== null && !Array.isArray(receipt)) {
    const value = (receipt as Record<string, unknown>).receiptNumber;
    if (typeof value === "string") return value.slice(0, 40);
  }
  return "—";
}
