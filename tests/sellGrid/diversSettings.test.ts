import {
  DEFAULT_DIVERS_SETTINGS,
  formFromDiversSettings,
  parseDiversSettings,
  parseMarginPercent,
  validateDiversForm,
} from "../../src/lib/sellGrid/diversSettings";

describe("Divers settings", () => {
  it("defaults to 200 DH for cashiers and a 20% margin", () => {
    expect(DEFAULT_DIVERS_SETTINGS).toEqual({ maxCents: 20000, marginPercent: 20 });
    expect(formFromDiversSettings(DEFAULT_DIVERS_SETTINGS)).toEqual({
      maxDh: "200.00",
      marginPercent: "20",
    });
  });

  it("accepts a maximum above zero and a margin from 0 to 95", () => {
    expect(validateDiversForm({ maxDh: "150,50", marginPercent: "12,5" })).toEqual({
      ok: true,
      settings: { maxCents: 15050, marginPercent: 12.5 },
    });
    expect(validateDiversForm({ maxDh: "0.01", marginPercent: "0" }).ok).toBe(true);
    expect(validateDiversForm({ maxDh: "200", marginPercent: "95" }).ok).toBe(true);
  });

  it("refuses a maximum that is empty, zero, negative or absurd", () => {
    for (const maxDh of ["", "0", "0.00", "-5", "abc", "999999999"]) {
      const result = validateDiversForm({ maxDh, marginPercent: "20" });
      expect(result).toEqual({ ok: false, errors: { maxDh: "settings.diversErrMax" } });
    }
  });

  it("refuses a margin outside 0 to 95", () => {
    for (const marginPercent of ["", "96", "100", "-1", "x", "12.345"]) {
      const result = validateDiversForm({ maxDh: "200", marginPercent });
      expect(result).toEqual({ ok: false, errors: { marginPercent: "settings.diversErrMargin" } });
    }
    expect(parseMarginPercent("95.01")).toBeNull();
  });

  it("reports both fields when both are wrong", () => {
    const result = validateDiversForm({ maxDh: "0", marginPercent: "99" });
    expect(result).toEqual({
      ok: false,
      errors: { maxDh: "settings.diversErrMax", marginPercent: "settings.diversErrMargin" },
    });
  });

  it("reads the two rows, falling back to the defaults for anything unusable", () => {
    expect(
      parseDiversSettings({ divers_max_cents: 30000 }, { divers_margin_percent: "35.00" })
    ).toEqual({ maxCents: 30000, marginPercent: 35 });
    expect(parseDiversSettings(null, null)).toEqual(DEFAULT_DIVERS_SETTINGS);
    expect(parseDiversSettings({ divers_max_cents: -1 }, { divers_margin_percent: null })).toEqual(
      DEFAULT_DIVERS_SETTINGS
    );
    expect(parseDiversSettings({}, { divers_margin_percent: 0 }).marginPercent).toBe(0);
  });
});
