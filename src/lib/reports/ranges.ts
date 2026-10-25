export type RangeKey = "today" | "yesterday" | "7d" | "month" | "30d" | "custom";

export type DateRange = { from: Date; to: Date; label: string };

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Ranges are half-open [from, to): the end is the start of the next day, so
// a sale at 23:59 on the last day is still inside the range.
export function resolveRange(key: RangeKey, customFrom?: string, customTo?: string): DateRange {
  const today = startOfDay(new Date());

  switch (key) {
    case "today":
      return { from: today, to: addDays(today, 1), label: "Today" };
    case "yesterday":
      return { from: addDays(today, -1), to: today, label: "Yesterday" };
    case "7d":
      return { from: addDays(today, -6), to: addDays(today, 1), label: "Last 7 days" };
    case "month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: first, to: addDays(today, 1), label: "This month" };
    }
    case "30d":
      return { from: addDays(today, -29), to: addDays(today, 1), label: "Last 30 days" };
    case "custom": {
      const from = customFrom ? startOfDay(new Date(customFrom)) : today;
      const to = customTo ? addDays(startOfDay(new Date(customTo)), 1) : addDays(today, 1);
      return { from, to, label: "Custom" };
    }
  }
}

export function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}
