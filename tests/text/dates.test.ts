import { formatLocaleDate } from "../../src/lib/text/dates";

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
