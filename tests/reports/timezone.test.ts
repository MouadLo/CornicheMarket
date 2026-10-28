import {
  addDaysInTimeZone,
  startOfDayInTimeZone,
  startOfMonthInTimeZone,
} from "../../src/lib/reports/timezone";

describe("startOfDayInTimeZone", () => {
  it("a sale at 23:30 Casablanca time stays on that calendar day, not UTC's next day", () => {
    // 2026-01-15 23:30 in Africa/Casablanca (UTC+1) is 2026-01-15T22:30:00Z.
    // In plain UTC terms that's still "the 15th", but the point of this
    // test is the boundary case where UTC and the store's zone would
    // disagree: that same wall-clock sale, expressed instead via a time
    // zone some hours behind UTC, would appear as the PREVIOUS UTC day
    // while still correctly being "the 15th" in Casablanca.
    const saleInstant = new Date("2026-01-15T22:30:00.000Z"); // 23:30 in UTC+1
    const start = startOfDayInTimeZone(saleInstant, "Africa/Casablanca");

    // Midnight on the 15th in Casablanca (UTC+1) is 2026-01-14T23:00:00Z.
    expect(start.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(saleInstant.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(saleInstant.getTime()).toBeLessThan(start.getTime() + 24 * 60 * 60 * 1000);
  });

  it("a sale at 00:30 Casablanca time lands on the NEXT calendar day, not the previous one", () => {
    // 2026-01-16 00:30 in Africa/Casablanca (UTC+1) is 2026-01-15T23:30:00Z.
    const saleInstant = new Date("2026-01-15T23:30:00.000Z"); // 00:30 the next day, UTC+1
    const startOf15th = startOfDayInTimeZone(
      new Date("2026-01-15T22:30:00.000Z"),
      "Africa/Casablanca"
    );
    const startOf16th = startOfDayInTimeZone(saleInstant, "Africa/Casablanca");

    // Must NOT fall in the 15th's bucket -- that is exactly the bug this
    // fixes: a browser in a different time zone (or raw UTC math) could
    // otherwise group a just-after-midnight sale with the previous day.
    expect(startOf16th.getTime()).toBeGreaterThan(startOf15th.getTime());
    expect(startOf16th.toISOString()).toBe("2026-01-15T23:00:00.000Z");
  });

  it("is idempotent: the start of a day's own start-of-day is itself", () => {
    const start = startOfDayInTimeZone(new Date("2026-06-01T12:00:00.000Z"), "Africa/Casablanca");
    expect(startOfDayInTimeZone(start, "Africa/Casablanca").getTime()).toBe(start.getTime());
  });

  it("handles a DST-observing zone correctly across a spring-forward transition", () => {
    // America/New_York: 2026-03-08 is the US DST start (clocks jump
    // 02:00 -> 03:00). A naive "just add 24h" boundary would be wrong for
    // the days around this transition; computing from wall-clock midnight
    // each time (as this function does) is not.
    const beforeTransition = startOfDayInTimeZone(
      new Date("2026-03-07T18:00:00.000Z"),
      "America/New_York"
    );
    const afterTransition = startOfDayInTimeZone(
      new Date("2026-03-09T18:00:00.000Z"),
      "America/New_York"
    );

    // March 7 00:00 EST (UTC-5) = March 7 05:00 UTC.
    expect(beforeTransition.toISOString()).toBe("2026-03-07T05:00:00.000Z");
    // March 9 00:00 EDT (UTC-4, after springing forward) = March 9 04:00 UTC.
    expect(afterTransition.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("addDaysInTimeZone", () => {
  it("adding 1 day lands on the next calendar day in that zone, exactly 24h apart outside DST", () => {
    const day1 = startOfDayInTimeZone(new Date("2026-01-15T12:00:00.000Z"), "Africa/Casablanca");
    const day2 = addDaysInTimeZone(day1, 1, "Africa/Casablanca");
    expect(day2.getTime() - day1.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("stepping across a DST transition still lands on the correct calendar day (not off by an hour)", () => {
    const mar7 = startOfDayInTimeZone(new Date("2026-03-07T12:00:00.000Z"), "America/New_York");
    const mar9 = addDaysInTimeZone(mar7, 2, "America/New_York");
    // The wall-clock calendar date must be exactly two days later, even
    // though the UTC gap is 47h (one hour short of 48h) across the
    // spring-forward transition.
    expect(mar9.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("negative days go backwards correctly", () => {
    const day1 = startOfDayInTimeZone(new Date("2026-01-15T12:00:00.000Z"), "Africa/Casablanca");
    const dayBefore = addDaysInTimeZone(day1, -1, "Africa/Casablanca");
    expect(day1.getTime() - dayBefore.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("startOfMonthInTimeZone", () => {
  it("Africa/Casablanca (ahead of UTC): first of the month", () => {
    // Jan 15 in Casablanca -> month start is Jan 1 00:00 UTC+1 = Dec 31 23:00Z.
    const start = startOfMonthInTimeZone(new Date("2026-01-15T12:00:00.000Z"), "Africa/Casablanca");
    expect(start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("a time zone BEHIND UTC: must not land on the previous month", () => {
    // This is the case a naive "guess UTC midnight, then re-derive the
    // day from that guess" implementation gets wrong: for a negative UTC
    // offset, midnight UTC on the 1st reads as the LAST day of the
    // previous month once reformatted in that zone. Pacific/Honolulu is
    // UTC-10 with no DST, so this is unambiguous.
    const start = startOfMonthInTimeZone(new Date("2026-06-15T12:00:00.000Z"), "Pacific/Honolulu");
    // June 1 00:00 HST (UTC-10) = June 1 10:00 UTC.
    expect(start.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("is idempotent and matches startOfDayInTimeZone for a day-1 date", () => {
    const start = startOfMonthInTimeZone(new Date("2026-03-20T00:00:00.000Z"), "Africa/Casablanca");
    expect(startOfDayInTimeZone(start, "Africa/Casablanca").getTime()).toBe(start.getTime());
  });
});
