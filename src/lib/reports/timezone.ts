// Computes day boundaries in an arbitrary IANA time zone, without a date
// library. Needed because "today" / "yesterday" / "this month" must mean
// the STORE's calendar day (e.g. Africa/Casablanca), never the device's
// own system time zone -- a sale at 23:30 local time must count as that
// day even if whoever opens Reports later is in a browser set to UTC.

// The offset (in ms) that `timeZone`'s wall-clock reading of `date` has
// from UTC, at that instant. Re-derived per call (not cached) so it stays
// correct across a DST transition.
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );

  return asUtc - date.getTime();
}

// Midnight (00:00:00.000) of `date`'s calendar day AS SEEN in `timeZone`,
// returned as the equivalent UTC instant.
export function startOfDayInTimeZone(date: Date, timeZone: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  // Midnight UTC of that calendar date is a good first guess; shift it
  // back by the zone's own offset at that instant to land on the instant
  // that reads as 00:00:00 in `timeZone`.
  const guessUtc = new Date(`${ymd}T00:00:00.000Z`);
  const offsetMs = timeZoneOffsetMs(guessUtc, timeZone);
  return new Date(guessUtc.getTime() - offsetMs);
}

export function addDaysInTimeZone(date: Date, days: number, timeZone: string): Date {
  // Anchor at local noon before shifting days, so landing on a DST
  // transition day can never skip or repeat a calendar day.
  const noon = new Date(startOfDayInTimeZone(date, timeZone).getTime() + 12 * 60 * 60 * 1000);
  const shifted = new Date(noon.getTime() + days * 24 * 60 * 60 * 1000);
  return startOfDayInTimeZone(shifted, timeZone);
}

// Midnight of the 1st of `date`'s calendar month, as seen in `timeZone`.
// Using Date's own getFullYear()/getMonth() here would read the SYSTEM's
// local time zone, not the one requested -- the same class of bug this
// whole module exists to avoid.
//
// Deliberately does NOT delegate to startOfDayInTimeZone with a UTC-
// midnight guess of "YYYY-MM-01": for a time zone BEHIND UTC (negative
// offset), that guess instant, re-formatted in `timeZone`, reads as the
// LAST day of the PREVIOUS month, not the 1st -- the same guess-then-
// correct arithmetic has to be applied directly against the month string,
// not round-tripped through day-level resolution.
export function startOfMonthInTimeZone(date: Date, timeZone: string): Date {
  const ym = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(date); // "YYYY-MM"

  const guessUtc = new Date(`${ym}-01T00:00:00.000Z`);
  const offsetMs = timeZoneOffsetMs(guessUtc, timeZone);
  return new Date(guessUtc.getTime() - offsetMs);
}
