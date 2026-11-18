// Calendar maths for the date picker. Dates are plain year/month/day values
// ("YYYY-MM-DD" strings at the edges); nothing here goes through local-time
// Date parsing, because new Date("2026-11-18") is UTC midnight and shows as
// the previous day in any zone west of UTC. Intl is only used to NAME things,
// always with timeZone "UTC" on a UTC date so the day can never shift.
import { resolveLocale } from "./dates";

export type YMD = { year: number; month: number; day: number }; // month 1-12

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatISODate({ year, month, day }: YMD): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// Strict: exactly YYYY-MM-DD and a date that exists. Anything else is null.
export function parseISODate(value: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

// 0 = Monday ... 6 = Sunday (Sakamoto's method, no Date involved).
export function weekdayMondayFirst({ year, month, day }: YMD): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  const sunday0 =
    (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[month - 1] + day) %
    7;
  return (sunday0 + 6) % 7;
}

// A month shift that keeps the day when it can and clamps when it cannot:
// 31 January + 1 month is 28 (or 29) February, never 3 March.
export function addMonths(date: YMD, delta: number): YMD {
  const index = date.year * 12 + (date.month - 1) + delta;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function addYears(date: YMD, delta: number): YMD {
  return addMonths(date, delta * 12);
}

// ISO strings of the same shape compare correctly as text. "" means no limit.
export function isWithinRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

export type CalendarCell = { iso: string; day: number; inMonth: boolean };

// Always 6 rows of 7, Monday first, so the calendar never changes height.
export function monthGrid(year: number, month: number): CalendarCell[][] {
  const lead = weekdayMondayFirst({ year, month, day: 1 });
  const first = { year, month, day: 1 };
  const rows: CalendarCell[][] = [];
  for (let row = 0; row < 6; row += 1) {
    const cells: CalendarCell[] = [];
    for (let col = 0; col < 7; col += 1) {
      const offset = row * 7 + col - lead;
      const cell = addDays(first, offset);
      cells.push({
        iso: formatISODate(cell),
        day: cell.day,
        inMonth: cell.year === year && cell.month === month,
      });
    }
    rows.push(cells);
  }
  return rows;
}

// Day shift by walking months; offsets here are small (under 42 days).
export function addDays(date: YMD, delta: number): YMD {
  let { year, month, day } = date;
  day += delta;
  while (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day += daysInMonth(year, month);
  }
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { year, month, day };
}

// ---- Names, in the app's language (same locales and Western digits as dates.ts)

function utcNoon(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(2000, month - 1, day, 12));
  date.setUTCFullYear(year);
  return date;
}

export function monthName(language: string, month: number): string {
  return new Intl.DateTimeFormat(resolveLocale(language), {
    month: "long",
    timeZone: "UTC",
  }).format(utcNoon(2000, month, 1));
}

// Monday first. 2001-01-01 was a Monday.
export function weekdayNames(language: string, width: "short" | "narrow" = "short"): string[] {
  const formatter = new Intl.DateTimeFormat(resolveLocale(language), {
    weekday: width,
    timeZone: "UTC",
  });
  return [0, 1, 2, 3, 4, 5, 6].map((i) => formatter.format(utcNoon(2001, 1, 1 + i)));
}

// "mercredi 18 novembre 2026": for display and for screen readers.
export function formatLongDate(iso: string, language: string): string {
  const ymd = parseISODate(iso);
  if (!ymd) return "";
  return new Intl.DateTimeFormat(resolveLocale(language), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcNoon(ymd.year, ymd.month, ymd.day));
}

// "18/11/2026": the compact form shown in the field.
export function formatShortDate(iso: string, language: string): string {
  const ymd = parseISODate(iso);
  if (!ymd) return "";
  return new Intl.DateTimeFormat(resolveLocale(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcNoon(ymd.year, ymd.month, ymd.day));
}
