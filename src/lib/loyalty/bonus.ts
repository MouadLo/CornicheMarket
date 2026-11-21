// Per-product bonus points (promos): an integer per unit sold and an optional
// last day, kept as the instant that ends that store day (the server compares
// sale.occurred_at < until).
import { storeDayKey } from "@/src/lib/sales/historyView";
import { addDaysInTimeZone } from "@/src/lib/reports/timezone";
import { parseISODate } from "@/src/lib/text/calendar";

export const MAX_BONUS_POINTS = 10000;

// "" means none (0). Whole numbers 0..10000, otherwise null.
export function parseBonusPoints(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MAX_BONUS_POINTS ? value : null;
}

// The last day of the promo, "YYYY-MM-DD" in the store's time zone, to the
// instant its day ends (= midnight starting the next store day). null when
// the day is not a real date.
export function bonusUntilFromDay(day: string, timeZone: string): string | null {
  if (!parseISODate(day)) return null;
  // Noon UTC of the date is on that calendar day in every zone the shop uses.
  const noon = new Date(`${day}T12:00:00.000Z`);
  return addDaysInTimeZone(noon, 1, timeZone).toISOString();
}

// The reverse, for showing the saved value: the store day that ends at `until`.
export function dayFromBonusUntil(until: string | null | undefined, timeZone: string): string {
  if (!until) return "";
  const end = new Date(until).getTime();
  if (Number.isNaN(end)) return "";
  return storeDayKey(new Date(end - 1).toISOString(), timeZone);
}

type BonusFields = {
  loyalty_excluded?: boolean | null;
  loyalty_bonus_points?: number | null;
  loyalty_bonus_until?: string | null;
};

// Does this product give bonus points right now? (Excluded products earn
// nothing, so never.)
export function bonusIsActive(product: BonusFields, now: Date = new Date()): boolean {
  if (product.loyalty_excluded) return false;
  if (!((product.loyalty_bonus_points ?? 0) > 0)) return false;
  if (!product.loyalty_bonus_until) return true;
  return now.getTime() < new Date(product.loyalty_bonus_until).getTime();
}
