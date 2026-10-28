import { addDaysInTimeZone, startOfDayInTimeZone, startOfMonthInTimeZone } from "./timezone";

export type RangeKey = "today" | "yesterday" | "7d" | "month" | "30d" | "custom";

// labelKey is an i18n key (e.g. "reports.today"), not display text -- the
// caller must call t(range.labelKey). Reuses the exact same keys the range
// chips already use (RANGE_KEYS in the Reports screen), so no new
// translations were needed for this.
export type DateRange = { from: Date; to: Date; labelKey: string };

export const DEFAULT_STORE_TIMEZONE = "Africa/Casablanca";

// Ranges are half-open [from, to): the end is the start of the next day, so
// a sale at 23:59 on the last day is still inside the range.
//
// All boundaries are computed in `timeZone` -- the STORE's own configured
// time zone (an owner setting; see src/lib/reports/queries.ts's
// fetchStoreTimezone), never the browser/device's local time zone. A sale
// at 23:30 local time must count as "today" even if whoever opens Reports
// is looking at a browser set to a different zone.
export function resolveRange(
  key: RangeKey,
  customFrom?: string,
  customTo?: string,
  timeZone: string = DEFAULT_STORE_TIMEZONE
): DateRange {
  const today = startOfDayInTimeZone(new Date(), timeZone);

  switch (key) {
    case "today":
      return { from: today, to: addDaysInTimeZone(today, 1, timeZone), labelKey: "reports.today" };
    case "yesterday":
      return {
        from: addDaysInTimeZone(today, -1, timeZone),
        to: today,
        labelKey: "reports.yesterday",
      };
    case "7d":
      return {
        from: addDaysInTimeZone(today, -6, timeZone),
        to: addDaysInTimeZone(today, 1, timeZone),
        labelKey: "reports.last7days",
      };
    case "month":
      return {
        from: startOfMonthInTimeZone(today, timeZone),
        to: addDaysInTimeZone(today, 1, timeZone),
        labelKey: "reports.thisMonth",
      };
    case "30d":
      return {
        from: addDaysInTimeZone(today, -29, timeZone),
        to: addDaysInTimeZone(today, 1, timeZone),
        labelKey: "reports.last30days",
      };
    case "custom": {
      const from = customFrom ? startOfDayInTimeZone(new Date(customFrom), timeZone) : today;
      const to = customTo
        ? addDaysInTimeZone(startOfDayInTimeZone(new Date(customTo), timeZone), 1, timeZone)
        : addDaysInTimeZone(today, 1, timeZone);
      return { from, to, labelKey: "reports.custom" };
    }
  }
}

export function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}
