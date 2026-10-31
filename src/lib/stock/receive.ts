import { parseMoneyToCents, parseQuantity } from "@/src/lib/money";
import type { PriceUpdate, ReceiveLine } from "@/src/lib/stock/queries";

export type ExpiryResult = { ok: true; value: string | null } | { ok: false };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MONTH_YEAR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one, leap years included.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Empty means "no expiry". Anything typed must be a date that exists, in
// YYYY-MM-DD or DD/MM/YYYY; a typo is reported, never silently dropped.
export function normalizeExpiryDate(input: string): ExpiryResult {
  const text = input.trim();
  if (!text) return { ok: true, value: null };

  let year: number, month: number, day: number;
  const iso = ISO_DATE.exec(text);
  const dmy = DAY_MONTH_YEAR.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  } else {
    return { ok: false };
  }

  if (!isRealCalendarDate(year, month, day)) return { ok: false };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { ok: true, value: `${year}-${pad(month)}-${pad(day)}` };
}

export type DraftLineInput = {
  product: { id: string };
  quantity: string;
  unitCost: string;
  expiryDate: string;
  newSellingPriceCents: number | null;
};

export type ReceivePayload = {
  lines: ReceiveLine[];
  priceUpdates: PriceUpdate[];
  invalidCount: number;
};

// Turns the screen's text fields into what receive_delivery expects. Lines
// that can't be saved as typed are counted, not guessed at.
export function buildReceivePayload(draft: DraftLineInput[]): ReceivePayload {
  const lines: ReceiveLine[] = [];
  const priceUpdates: PriceUpdate[] = [];
  let invalidCount = 0;

  for (const line of draft) {
    const quantity = parseQuantity(line.quantity);
    const cost = parseMoneyToCents(line.unitCost);
    const expiry = normalizeExpiryDate(line.expiryDate);
    if (quantity === null || quantity <= 0 || cost === null || !expiry.ok) {
      invalidCount += 1;
      continue;
    }

    lines.push({
      product_id: line.product.id,
      quantity,
      unit_cost_cents: cost,
      expiry_date: expiry.value,
    });
    if (line.newSellingPriceCents !== null) {
      priceUpdates.push({
        product_id: line.product.id,
        selling_price_cents: line.newSellingPriceCents,
      });
    }
  }

  return { lines, priceUpdates, invalidCount };
}
