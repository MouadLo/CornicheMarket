import { checkAdjustment } from "../../src/lib/loyalty/adjust";
import {
  bonusIsActive,
  bonusUntilFromDay,
  dayFromBonusUntil,
  parseBonusPoints,
} from "../../src/lib/loyalty/bonus";
import {
  ledgerLabelKey,
  pointsText,
  signedPoints,
  valueAndPoints,
} from "../../src/lib/loyalty/display";
import { loyaltyErrorKey } from "../../src/lib/loyalty/errors";
import {
  DEFAULT_LOYALTY_SETTINGS,
  formFromSettings,
  parseLoyaltySettings,
  ratesFromSettings,
  validateLoyaltyForm,
} from "../../src/lib/loyalty/settings";
import { authRedirect } from "../../src/lib/nav/authRedirect";

const t = (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key);

describe("settings form", () => {
  const form = formFromSettings(DEFAULT_LOYALTY_SETTINGS);

  it("shows the defaults the way the owner reads them", () => {
    expect(form).toEqual({
      enabled: false,
      dhPerPoint: "10.00",
      dhFor100Points: "10.00",
      minPoints: "100",
      dailyPoints: "100",
      welcomePoints: "0",
    });
  });

  it("turns '100 points = X DH' into centimes per point", () => {
    const result = validateLoyaltyForm({ ...form, dhFor100Points: "12.00", dhPerPoint: "5" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.pointValueCents).toBe(12);
      expect(result.settings.centsPerPoint).toBe(500);
      expect(ratesFromSettings(result.settings)).toEqual({
        centsPerPoint: 500,
        pointValueCents: 12,
        minRedeemPoints: 100,
      });
    }
  });

  it("refuses a value that is not a whole number of centimes per point", () => {
    const result = validateLoyaltyForm({ ...form, dhFor100Points: "10.50" });
    expect(result).toEqual({
      ok: false,
      errors: { dhFor100Points: "loyalty.errPointValueFraction" },
    });
  });

  it("refuses zero, negative, empty and text amounts, and fractional or huge counts", () => {
    const result = validateLoyaltyForm({
      ...form,
      dhPerPoint: "0",
      dhFor100Points: "abc",
      minPoints: "0",
      dailyPoints: "1.5",
      welcomePoints: "-3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "dailyPoints",
        "dhFor100Points",
        "dhPerPoint",
        "minPoints",
        "welcomePoints",
      ]);
    }
    expect(validateLoyaltyForm({ ...form, minPoints: "99999999999" }).ok).toBe(false);
  });

  it("accepts welcome points of 0 and keeps the switch", () => {
    const result = validateLoyaltyForm({ ...form, enabled: true, welcomePoints: "0" });
    expect(result.ok && result.settings.enabled).toBe(true);
  });

  it("parseLoyaltySettings keeps defaults for missing or nonsense values", () => {
    expect(parseLoyaltySettings(null)).toEqual(DEFAULT_LOYALTY_SETTINGS);
    expect(
      parseLoyaltySettings({
        loyalty_enabled: true,
        loyalty_cents_per_point: "x",
        loyalty_welcome_points: 0,
      })
    ).toEqual({ ...DEFAULT_LOYALTY_SETTINGS, enabled: true });
  });
});

describe("bonus", () => {
  it("parses points: empty is 0, whole numbers up to 10000", () => {
    expect(parseBonusPoints("")).toBe(0);
    expect(parseBonusPoints(" 20 ")).toBe(20);
    expect(parseBonusPoints("10000")).toBe(10000);
    expect(parseBonusPoints("10001")).toBeNull();
    expect(parseBonusPoints("-1")).toBeNull();
    expect(parseBonusPoints("2.5")).toBeNull();
    expect(parseBonusPoints("abc")).toBeNull();
  });

  it("stores the last day as the instant that day ends in the store's zone", () => {
    // Casablanca is UTC+1 in winter: the day after 2026-12-31 starts at 23:00Z.
    expect(bonusUntilFromDay("2026-12-31", "Africa/Casablanca")).toBe("2026-12-31T23:00:00.000Z");
    expect(bonusUntilFromDay("2026-12-31", "UTC")).toBe("2027-01-01T00:00:00.000Z");
    expect(bonusUntilFromDay("2026-02-30", "UTC")).toBeNull();
    expect(bonusUntilFromDay("", "UTC")).toBeNull();
  });

  it("shows the saved instant as that same last day", () => {
    const until = bonusUntilFromDay("2026-12-31", "Africa/Casablanca") as string;
    expect(dayFromBonusUntil(until, "Africa/Casablanca")).toBe("2026-12-31");
    expect(dayFromBonusUntil(null, "UTC")).toBe("");
    expect(dayFromBonusUntil("not a date", "UTC")).toBe("");
  });

  it("a bonus is active only while it runs and never on an excluded product", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(bonusIsActive({ loyalty_bonus_points: 20 }, now)).toBe(true);
    expect(bonusIsActive({ loyalty_bonus_points: 0 }, now)).toBe(false);
    expect(bonusIsActive({ loyalty_bonus_points: 20, loyalty_excluded: true }, now)).toBe(false);
    expect(
      bonusIsActive({ loyalty_bonus_points: 20, loyalty_bonus_until: "2026-11-21T00:00:00Z" }, now)
    ).toBe(true);
    expect(
      bonusIsActive({ loyalty_bonus_points: 20, loyalty_bonus_until: "2026-11-20T12:00:00Z" }, now)
    ).toBe(false);
    expect(bonusIsActive({}, now)).toBe(false);
  });
});

describe("adjustment", () => {
  it("needs a non-zero whole number and a note", () => {
    expect(checkAdjustment("+50", "gesture", 10)).toEqual({
      ok: true,
      points: 50,
      note: "gesture",
    });
    expect(checkAdjustment("-5", " erreur ", 10)).toEqual({ ok: true, points: -5, note: "erreur" });
    expect(checkAdjustment("−20", "x", 100)).toEqual({ ok: true, points: -20, note: "x" });
    expect(checkAdjustment("0", "x", 10)).toEqual({ ok: false, error: "loyalty.errAdjustPoints" });
    expect(checkAdjustment("1.5", "x", 10)).toEqual({
      ok: false,
      error: "loyalty.errAdjustPoints",
    });
    expect(checkAdjustment("abc", "x", 10)).toEqual({
      ok: false,
      error: "loyalty.errAdjustPoints",
    });
    expect(checkAdjustment("5", "  ", 10)).toEqual({ ok: false, error: "loyalty.errAdjustNote" });
    expect(checkAdjustment("5", "x".repeat(201), 10)).toEqual({
      ok: false,
      error: "loyalty.errAdjustNote",
    });
  });

  it("never takes the balance below zero", () => {
    expect(checkAdjustment("-11", "x", 10)).toEqual({
      ok: false,
      error: "loyalty.errAdjustBelowZero",
    });
    expect(checkAdjustment("-10", "x", 10).ok).toBe(true);
  });
});

describe("display", () => {
  it("puts the dirham value first and the points second", () => {
    const text = valueAndPoints(t, 34, 10);
    expect(text.indexOf("3.40 DH")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("3.40 DH")).toBeLessThan(text.indexOf("loyalty.pointsMany"));
  });

  it("uses the singular for exactly one point", () => {
    expect(pointsText(t, 1)).toContain("loyalty.pointsOne");
    expect(pointsText(t, 0)).toContain("loyalty.pointsMany");
    expect(pointsText(t, 2)).toContain("loyalty.pointsMany");
  });

  it("signs points with a real minus, always left to right", () => {
    expect(signedPoints(12)).toBe("⁦+12⁩");
    expect(signedPoints(-7)).toBe("⁦−7⁩");
  });

  it("labels each kind, and a welcome adjustment as Welcome", () => {
    expect(ledgerLabelKey("earn")).toBe("loyalty.kindEarn");
    expect(ledgerLabelKey("redeem")).toBe("loyalty.kindRedeem");
    expect(ledgerLabelKey("sale_adjust")).toBe("loyalty.kindSaleAdjust");
    expect(ledgerLabelKey("adjust", "welcome")).toBe("loyalty.kindWelcome");
    expect(ledgerLabelKey("adjust", "gesture")).toBe("loyalty.kindAdjust");
    expect(ledgerLabelKey("adjust", null)).toBe("loyalty.kindAdjust");
  });
});

describe("loyalty error keys", () => {
  it("translates the server's refusals and never shows their text", () => {
    expect(loyaltyErrorKey(new Error("Not a valid Moroccan phone number"))).toBe(
      "loyalty.errPhone"
    );
    expect(loyaltyErrorKey(new Error("The customer must agree to join"))).toBe(
      "loyalty.errConsent"
    );
    expect(loyaltyErrorKey(new Error("Not a loyalty member"))).toBe("loyalty.errNotMember");
    expect(loyaltyErrorKey(new Error("The adjustment cannot be zero"))).toBe("loyalty.errAdjust");
    expect(loyaltyErrorKey(new Error("A note of 1 to 200 characters is required"))).toBe(
      "loyalty.errAdjust"
    );
    expect(loyaltyErrorKey(new Error("Only an owner can adjust points"))).toBe("errors.permission");
    expect(loyaltyErrorKey(new TypeError("Failed to fetch"))).toBe("errors.network");
    expect(loyaltyErrorKey(new Error("boom"), "loyalty.errEnrol")).toBe("loyalty.errEnrol");
  });
});

describe("navigation guard", () => {
  it("leaves the card page alone, signed out or signed in", () => {
    expect(authRedirect(null, ["card", "[token]"])).toBeNull();
    expect(authRedirect({ user: 1 }, ["card", "[token]"])).toBeNull();
  });

  it("still sends a signed-out visitor to sign-in and a signed-in one into the app", () => {
    expect(authRedirect(null, ["(app)", "sell"])).toBe("/sign-in");
    expect(authRedirect(null, [])).toBe("/sign-in");
    expect(authRedirect(null, ["sign-in"])).toBeNull();
    expect(authRedirect(null, ["accept-invite"])).toBeNull();
    expect(authRedirect({ user: 1 }, [])).toBe("/(app)/sell");
    expect(authRedirect({ user: 1 }, ["sign-in"])).toBe("/(app)/sell");
    expect(authRedirect({ user: 1 }, ["(app)", "settings"])).toBeNull();
    expect(authRedirect({ user: 1 }, ["accept-invite"])).toBeNull();
  });
});
