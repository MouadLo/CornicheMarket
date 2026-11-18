import { isSingleStoreDay, isValidDateInput, resolveRange } from "../../src/lib/reports/ranges";

// A fixed "now" so these tests don't depend on the day they happen to run.
// 2026-01-15 23:30 UTC+1 (Casablanca) -- deliberately late evening, so a
// bug that used the wrong time zone for "today" would be caught here too.
const NOW = new Date("2026-01-15T22:30:00.000Z");

describe("resolveRange: store-time-zone-aware boundaries", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("'today' in Casablanca spans Casablanca midnight to midnight, not the system clock's day", () => {
    const range = resolveRange("today", undefined, undefined, "Africa/Casablanca");
    expect(range.from.toISOString()).toBe("2026-01-14T23:00:00.000Z"); // Jan 15 00:00 UTC+1
    expect(range.to.toISOString()).toBe("2026-01-15T23:00:00.000Z"); // Jan 16 00:00 UTC+1
  });

  it("changing only the time zone changes which day 'today' resolves to", () => {
    // At this fixed instant (22:30Z), Pacific/Honolulu (UTC-10) is still
    // on January 15th at 12:30 -- same calendar day as Casablanca here,
    // so pick an instant where they'd actually disagree instead.
    const lateUtc = new Date("2026-01-15T23:30:00.000Z"); // 00:30 Jan 16 in Casablanca
    jest.setSystemTime(lateUtc);

    const casa = resolveRange("today", undefined, undefined, "Africa/Casablanca");
    const honolulu = resolveRange("today", undefined, undefined, "Pacific/Honolulu");

    // Casablanca has already turned over to the 16th; Honolulu (UTC-10)
    // is still deep in the 15th. The two zones must disagree here.
    expect(casa.from.toISOString()).not.toBe(honolulu.from.toISOString());
  });

  it("'yesterday' is the single day immediately before 'today', with no gap or overlap", () => {
    const today = resolveRange("today", undefined, undefined, "Africa/Casablanca");
    const yesterday = resolveRange("yesterday", undefined, undefined, "Africa/Casablanca");
    expect(yesterday.to.getTime()).toBe(today.from.getTime());
  });

  it("'7d' covers exactly 7 calendar days, ending at the start of today+1", () => {
    const range = resolveRange("7d", undefined, undefined, "Africa/Casablanca");
    const today = resolveRange("today", undefined, undefined, "Africa/Casablanca");
    expect(range.to.getTime()).toBe(today.to.getTime());
    expect((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)).toBe(7);
  });

  it("'month' starts on the 1st of the current month in the store's time zone", () => {
    const range = resolveRange("month", undefined, undefined, "Africa/Casablanca");
    expect(range.from.toISOString()).toBe("2025-12-31T23:00:00.000Z"); // Jan 1 00:00 UTC+1
  });

  it("defaults to Africa/Casablanca when no time zone is given", () => {
    const explicit = resolveRange("today", undefined, undefined, "Africa/Casablanca");
    const defaulted = resolveRange("today");
    expect(defaulted.from.getTime()).toBe(explicit.from.getTime());
    expect(defaulted.to.getTime()).toBe(explicit.to.getTime());
  });

  it("custom range uses the store time zone for both bounds", () => {
    const range = resolveRange("custom", "2026-01-10", "2026-01-12", "Africa/Casablanca");
    expect(range.from.toISOString()).toBe("2026-01-09T23:00:00.000Z"); // Jan 10 00:00 UTC+1
    expect(range.to.toISOString()).toBe("2026-01-12T23:00:00.000Z"); // Jan 13 00:00 UTC+1 (half-open)
  });
});

describe("isValidDateInput", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isValidDateInput("2026-01-15")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidDateInput("15/01/2026")).toBe(false);
    expect(isValidDateInput("not a date")).toBe(false);
    expect(isValidDateInput("")).toBe(false);
  });
});

describe("isSingleStoreDay", () => {
  const NOW_UTC = new Date("2026-01-15T10:00:00.000Z");
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_UTC);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(["UTC", "Asia/Tokyo"])("Today and Yesterday are one day in %s", (tz) => {
    expect(isSingleStoreDay(resolveRange("today", undefined, undefined, tz), tz)).toBe(true);
    expect(isSingleStoreDay(resolveRange("yesterday", undefined, undefined, tz), tz)).toBe(true);
  });

  it.each(["UTC", "Asia/Tokyo"])("a custom range with From equal To is one day in %s", (tz) => {
    expect(isSingleStoreDay(resolveRange("custom", "2026-01-10", "2026-01-10", tz), tz)).toBe(true);
  });

  it.each(["UTC", "Asia/Tokyo"])("longer ranges are not one day in %s", (tz) => {
    expect(isSingleStoreDay(resolveRange("custom", "2026-01-10", "2026-01-11", tz), tz)).toBe(
      false
    );
    expect(isSingleStoreDay(resolveRange("7d", undefined, undefined, tz), tz)).toBe(false);
    expect(isSingleStoreDay(resolveRange("30d", undefined, undefined, tz), tz)).toBe(false);
  });

  it("an empty or inverted range is not one day", () => {
    const at = new Date("2026-01-10T00:00:00.000Z");
    expect(isSingleStoreDay({ from: at, to: at }, "UTC")).toBe(false);
    expect(isSingleStoreDay({ from: new Date(at.getTime() + 1), to: at }, "UTC")).toBe(false);
  });

  it("a 23-hour day across a clock change still counts as one day", () => {
    // Europe/Paris springs forward on 2026-03-29: that day is 23 hours long.
    const tz = "Europe/Paris";
    const range = resolveRange("custom", "2026-03-29", "2026-03-29", tz);
    expect(range.to.getTime() - range.from.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(isSingleStoreDay(range, tz)).toBe(true);
  });

  it("is decided in the store zone, not UTC", () => {
    // A Tokyo midnight-to-midnight range is one Tokyo day, but not one UTC day.
    const tokyo = resolveRange("custom", "2026-01-10", "2026-01-10", "Asia/Tokyo");
    expect(tokyo.from.toISOString()).toBe("2026-01-09T15:00:00.000Z");
    expect(isSingleStoreDay(tokyo, "Asia/Tokyo")).toBe(true);
    expect(isSingleStoreDay(tokyo, "UTC")).toBe(false);
  });
});
