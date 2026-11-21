// The owner's loyalty settings and the pure rules for editing them. Money is
// integer centimes; the owner types "1 point per [10.00] DH" and "[100] points
// = [10.00] DH", and the database stores centimes per point.
import { centsToDisplay, parseMoneyToCents } from "@/src/lib/money";
import type { LoyaltyRates } from "@/src/lib/loyalty/points";

export type LoyaltySettings = {
  enabled: boolean;
  centsPerPoint: number; // 1000: 1 point per full 10.00 DH paid
  pointValueCents: number; // 10: 1 point is worth 0.10 DH
  minRedeemPoints: number; // fewest points that can be spent at once
  dailyReviewPoints: number; // more earned by one customer in a day flags the sale
  welcomePoints: number; // given when a customer joins
};

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  centsPerPoint: 1000,
  pointValueCents: 10,
  minRedeemPoints: 100,
  dailyReviewPoints: 100,
  welcomePoints: 0,
};

export function ratesFromSettings(settings: LoyaltySettings): LoyaltyRates {
  return {
    centsPerPoint: settings.centsPerPoint,
    pointValueCents: settings.pointValueCents,
    minRedeemPoints: settings.minRedeemPoints,
  };
}

// The reference amount of the "[100] points = [x] DH" line.
export const POINTS_FOR_VALUE = 100;

export type LoyaltyForm = {
  enabled: boolean;
  dhPerPoint: string; // "10.00"
  dhFor100Points: string; // "10.00"
  minPoints: string;
  dailyPoints: string;
  welcomePoints: string;
};

export type LoyaltyField =
  "dhPerPoint" | "dhFor100Points" | "minPoints" | "dailyPoints" | "welcomePoints";

export function formFromSettings(settings: LoyaltySettings): LoyaltyForm {
  return {
    enabled: settings.enabled,
    dhPerPoint: centsToDisplay(settings.centsPerPoint),
    dhFor100Points: centsToDisplay(settings.pointValueCents * POINTS_FOR_VALUE),
    minPoints: String(settings.minRedeemPoints),
    dailyPoints: String(settings.dailyReviewPoints),
    welcomePoints: String(settings.welcomePoints),
  };
}

// A whole number of at least `min`, at most `max`; null otherwise.
export function parseWholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

const MAX_CENTS_PER_POINT = 1_000_000; // 10 000.00 DH for one point: far above any real shop
const MAX_VALUE_FOR_100_CENTS = 1_000_000;

export type LoyaltyValidation =
  | { ok: true; settings: LoyaltySettings }
  // Translation keys, one per field that is wrong.
  | { ok: false; errors: Partial<Record<LoyaltyField, string>> };

export function validateLoyaltyForm(form: LoyaltyForm): LoyaltyValidation {
  const errors: Partial<Record<LoyaltyField, string>> = {};

  const centsPerPoint = parseMoneyToCents(form.dhPerPoint);
  if (centsPerPoint === null || centsPerPoint < 1 || centsPerPoint > MAX_CENTS_PER_POINT) {
    errors.dhPerPoint = "loyalty.errRatePerPoint";
  }

  // 100 points are worth X DH, so one point is X/100 DH: it must come out as a
  // whole number of centimes (10.00 DH -> 10 cts; 10.50 DH would be 10.5 cts).
  const valueFor100 = parseMoneyToCents(form.dhFor100Points);
  let pointValueCents = 0;
  if (
    valueFor100 === null ||
    valueFor100 < POINTS_FOR_VALUE ||
    valueFor100 > MAX_VALUE_FOR_100_CENTS
  ) {
    errors.dhFor100Points = "loyalty.errPointValue";
  } else if (valueFor100 % POINTS_FOR_VALUE !== 0) {
    errors.dhFor100Points = "loyalty.errPointValueFraction";
  } else {
    pointValueCents = valueFor100 / POINTS_FOR_VALUE;
  }

  const minRedeemPoints = parseWholeNumber(form.minPoints, 1, 1_000_000);
  if (minRedeemPoints === null) errors.minPoints = "loyalty.errMinPoints";
  const dailyReviewPoints = parseWholeNumber(form.dailyPoints, 1, 1_000_000);
  if (dailyReviewPoints === null) errors.dailyPoints = "loyalty.errDailyPoints";
  const welcomePoints = parseWholeNumber(form.welcomePoints, 0, 100_000);
  if (welcomePoints === null) errors.welcomePoints = "loyalty.errWelcomePoints";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      enabled: form.enabled,
      centsPerPoint: centsPerPoint as number,
      pointValueCents,
      minRedeemPoints: minRedeemPoints as number,
      dailyReviewPoints: dailyReviewPoints as number,
      welcomePoints: welcomePoints as number,
    },
  };
}

// Reads a store_settings row (numbers can arrive as strings), keeping the
// default for anything missing or out of range, so a half-migrated server never
// shows nonsense.
export function parseLoyaltySettings(
  row: Record<string, unknown> | null | undefined
): LoyaltySettings {
  const d = DEFAULT_LOYALTY_SETTINGS;
  const positive = (value: unknown, fallback: number, allowZero = false) => {
    const n = Number(value);
    return Number.isInteger(n) && (allowZero ? n >= 0 : n > 0) ? n : fallback;
  };
  return {
    enabled: row?.loyalty_enabled === true,
    centsPerPoint: positive(row?.loyalty_cents_per_point, d.centsPerPoint),
    pointValueCents: positive(row?.loyalty_point_value_cents, d.pointValueCents),
    minRedeemPoints: positive(row?.loyalty_min_redeem_points, d.minRedeemPoints),
    dailyReviewPoints: positive(row?.loyalty_daily_review_points, d.dailyReviewPoints),
    welcomePoints: positive(row?.loyalty_welcome_points, d.welcomePoints, true),
  };
}
