import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  formatISODate,
  formatLongDate,
  formatShortDate,
  isLeapYear,
  isWithinRange,
  monthGrid,
  monthName,
  parseISODate,
  weekdayMondayFirst,
  weekdayNames,
} from "../../src/lib/text/calendar";

describe("leap years and month lengths", () => {
  it("knows the leap year rules", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
  it("gives every month its length", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

describe("parseISODate", () => {
  it("accepts real dates only", () => {
    expect(parseISODate("2026-11-18")).toEqual({ year: 2026, month: 11, day: 18 });
    expect(parseISODate("2028-02-29")).not.toBeNull();
    expect(parseISODate("2027-02-29")).toBeNull();
    expect(parseISODate("2026-13-01")).toBeNull();
    expect(parseISODate("2026-4-5")).toBeNull();
    expect(parseISODate("")).toBeNull();
  });
  it("round-trips through formatISODate", () => {
    expect(formatISODate({ year: 2026, month: 3, day: 5 })).toBe("2026-03-05");
  });
});

describe("weekdays and the month grid", () => {
  it("numbers Monday as 0", () => {
    expect(weekdayMondayFirst({ year: 2026, month: 11, day: 16 })).toBe(0); // Monday
    expect(weekdayMondayFirst({ year: 2026, month: 11, day: 18 })).toBe(2); // Wednesday
    expect(weekdayMondayFirst({ year: 2026, month: 11, day: 22 })).toBe(6); // Sunday
    expect(weekdayMondayFirst({ year: 2024, month: 2, day: 29 })).toBe(3); // Thursday
  });
  it("lays November 2026 out Monday first (the 1st is a Sunday)", () => {
    const grid = monthGrid(2026, 11);
    expect(grid).toHaveLength(6);
    expect(grid.every((row) => row.length === 7)).toBe(true);
    expect(grid[0][5]).toEqual({ iso: "2026-10-31", day: 31, inMonth: false });
    expect(grid[0][6]).toEqual({ iso: "2026-11-01", day: 1, inMonth: true });
    expect(grid[4][0].iso).toBe("2026-11-23");
    const inMonth = grid.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(30);
  });
  it("starts on the 1st when it is a Monday, and crosses the year", () => {
    expect(monthGrid(2026, 6)[0][0]).toEqual({ iso: "2026-06-01", day: 1, inMonth: true });
    expect(monthGrid(2026, 1).flat().at(-1)?.iso).toBe("2026-02-08");
    expect(monthGrid(2027, 1)[0][0].iso).toBe("2026-12-28");
  });
  it("shows 29 February in a leap year", () => {
    expect(
      monthGrid(2028, 2)
        .flat()
        .filter((c) => c.inMonth)
    ).toHaveLength(29);
  });
});

describe("moving by months and years", () => {
  it("moves a month and rolls the year", () => {
    expect(addMonths({ year: 2026, month: 12, day: 10 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 10,
    });
    expect(addMonths({ year: 2026, month: 1, day: 10 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 10,
    });
  });
  it("clamps 31 January + 1 month to a valid date", () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(addMonths({ year: 2026, month: 3, day: 31 }, -1).day).toBe(28);
  });
  it("clamps 29 February when the year changes", () => {
    expect(addYears({ year: 2028, month: 2, day: 29 }, 1)).toEqual({
      year: 2029,
      month: 2,
      day: 28,
    });
    expect(addYears({ year: 2028, month: 2, day: 29 }, 4)).toEqual({
      year: 2032,
      month: 2,
      day: 29,
    });
  });
  it("walks days across month ends", () => {
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
    expect(addDays({ year: 2026, month: 2, day: 28 }, 1)).toEqual({ year: 2026, month: 3, day: 1 });
  });
});

describe("isWithinRange", () => {
  it("treats both ends as inclusive and empty limits as open", () => {
    expect(isWithinRange("2026-11-18", "2026-11-18", "2026-11-18")).toBe(true);
    expect(isWithinRange("2026-11-17", "2026-11-18")).toBe(false);
    expect(isWithinRange("2026-11-19", undefined, "2026-11-18")).toBe(false);
    expect(isWithinRange("2026-11-19", "", "")).toBe(true);
  });
});

describe("no time zone shifts", () => {
  const zones = ["Pacific/Honolulu", "America/New_York", "UTC", "Africa/Casablanca", "Asia/Tokyo"];
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("names the same day whatever the device zone is", () => {
    for (const zone of zones) {
      process.env.TZ = zone;
      expect(formatShortDate("2026-11-18", "fr")).toBe("18/11/2026");
      expect(formatLongDate("2026-11-18", "en")).toContain("18");
      expect(formatLongDate("2026-11-18", "en")).toContain("Wednesday");
      expect(monthGrid(2026, 11)[3][2].iso).toBe("2026-11-18");
    }
  });
});

describe("names in the app language", () => {
  it("gives Monday-first weekday names and month names", () => {
    expect(weekdayNames("en")[0]).toMatch(/^Mon/);
    expect(weekdayNames("fr")[6]).toMatch(/^dim/);
    expect(monthName("fr", 11)).toBe("novembre");
    expect(monthName("en", 2)).toBe("February");
    expect(weekdayNames("ar")).toHaveLength(7);
  });
  it("keeps Western digits in Arabic", () => {
    expect(formatShortDate("2026-11-18", "ar").replace(/[\u200e\u200f]/g, "")).toMatch(/^[0-9/]+$/);
    expect(formatLongDate("2026-11-18", "ar")).toMatch(/18/);
  });
  it("returns an empty string for a value that is not a date", () => {
    expect(formatShortDate("", "fr")).toBe("");
    expect(formatLongDate("2026-02-30", "fr")).toBe("");
  });
});
