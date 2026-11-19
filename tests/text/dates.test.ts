import {
  formatIsoDate,
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleDayMonth,
  formatLocaleMonthYear,
} from "../../src/lib/text/dates";

describe("formatLocaleDate", () => {
  const date = new Date("2026-01-05T10:00:00Z");

  it("FR: DD/MM/YYYY", () => {
    expect(formatLocaleDate(date, "fr")).toBe("05/01/2026");
  });

  it("EN: DD/MM/YYYY (Morocco-appropriate, not US MM/DD/YYYY)", () => {
    expect(formatLocaleDate(date, "en")).toBe("05/01/2026");
  });

  it("AR: Western digits (Morocco convention), not Eastern Arabic-Indic numerals", () => {
    const result = formatLocaleDate(date, "ar");
    expect(result).toContain("05");
    expect(result).toContain("01");
    expect(result).toContain("2026");
    // None of the Eastern Arabic-Indic digit characters (٠-٩) should appear.
    expect(result).not.toMatch(/[٠-٩]/);
  });

  it("falls back to fr-FR formatting for an unknown language code", () => {
    expect(formatLocaleDate(date, "es")).toBe("05/01/2026");
  });
});

describe("zone-aware date helpers", () => {
  // 2026-01-05 23:30 UTC is already 6 January in Tokyo.
  const late = new Date("2026-01-05T23:30:45Z");

  it("formatLocaleDate reads the given time zone", () => {
    expect(formatLocaleDate(late, "fr", "UTC")).toBe("05/01/2026");
    expect(formatLocaleDate(late, "fr", "Asia/Tokyo")).toBe("06/01/2026");
  });

  it("formatLocaleDateTime has no seconds and follows the zone", () => {
    expect(formatLocaleDateTime(late, "fr", "UTC")).toMatch(/05\/01\/2026.*23:30$/);
    expect(formatLocaleDateTime(late, "fr", "Asia/Tokyo")).toMatch(/06\/01\/2026.*08:30$/);
  });

  it("formatLocaleDayMonth gives day and month only", () => {
    expect(formatLocaleDayMonth(late, "en", "UTC")).toBe("05/01");
    expect(formatLocaleDayMonth(late, "en", "Asia/Tokyo")).toBe("06/01");
  });

  it("formatLocaleMonthYear reads a month bucket in UTC by default", () => {
    expect(formatLocaleMonthYear(new Date("2026-03-01T00:00:00Z"), "fr")).toContain("2026");
    expect(formatLocaleMonthYear(new Date("2026-03-01T00:00:00Z"), "en")).toBe("March 2026");
  });

  it("formatIsoDate keeps a date-only value on its own day", () => {
    expect(formatIsoDate("2026-01-05", "fr", "Asia/Tokyo")).toBe("05/01/2026");
    expect(formatIsoDate("2026-01-05", "fr", "Pacific/Pago_Pago")).toBe("05/01/2026");
  });

  it("formatIsoDate converts a full timestamp in the given zone", () => {
    expect(formatIsoDate("2026-01-05T23:30:00Z", "fr", "Asia/Tokyo")).toBe("06/01/2026");
  });
});
