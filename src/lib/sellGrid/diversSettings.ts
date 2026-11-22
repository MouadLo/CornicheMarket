// The owner's two Divers settings and the pure rules for editing them. The
// maximum is what a CASHIER may ring up in one Divers line (the owner has none);
// the margin is the owner's estimate used to cost a Divers line in reports.
import { centsToDisplay, parseMoneyToCents } from "@/src/lib/money";

export type DiversSettings = {
  maxCents: number;
  marginPercent: number;
};

export const DEFAULT_DIVERS_SETTINGS: DiversSettings = { maxCents: 20000, marginPercent: 20 };

// owner_settings.divers_margin_percent: check (between 0 and 95).
export const DIVERS_MARGIN_MAX = 95;
// 100 000.00 DH for one cashier line: far above any real counter sale.
const MAX_CENTS = 10_000_000;

export type DiversForm = { maxDh: string; marginPercent: string };
export type DiversField = keyof DiversForm;

export function formFromDiversSettings(settings: DiversSettings): DiversForm {
  return {
    maxDh: centsToDisplay(settings.maxCents),
    marginPercent: String(settings.marginPercent),
  };
}

// Reads the two settings rows; anything missing or out of range falls back to the default.
export function parseDiversSettings(
  store: Record<string, unknown> | null,
  owner: Record<string, unknown> | null
): DiversSettings {
  const max = store?.divers_max_cents;
  // numeric(5,2) arrives as a number or a string depending on the client.
  const margin = Number(owner?.divers_margin_percent);
  return {
    maxCents:
      Number.isSafeInteger(max) && (max as number) > 0
        ? (max as number)
        : DEFAULT_DIVERS_SETTINGS.maxCents,
    marginPercent:
      owner?.divers_margin_percent !== undefined &&
      owner?.divers_margin_percent !== null &&
      Number.isFinite(margin) &&
      margin >= 0 &&
      margin <= DIVERS_MARGIN_MAX
        ? margin
        : DEFAULT_DIVERS_SETTINGS.marginPercent,
  };
}

// A percentage with at most two decimals ("20", "12,5"), 0 to 95; null otherwise.
export function parseMarginPercent(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}([.,]\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return value >= 0 && value <= DIVERS_MARGIN_MAX ? value : null;
}

export type DiversValidation =
  | { ok: true; settings: DiversSettings }
  // Translation keys, one per field that is wrong.
  | { ok: false; errors: Partial<Record<DiversField, string>> };

export function validateDiversForm(form: DiversForm): DiversValidation {
  const errors: Partial<Record<DiversField, string>> = {};

  const maxCents = parseMoneyToCents(form.maxDh);
  if (maxCents === null || maxCents <= 0 || maxCents > MAX_CENTS) {
    errors.maxDh = "settings.diversErrMax";
  }
  const marginPercent = parseMarginPercent(form.marginPercent);
  if (marginPercent === null) errors.marginPercent = "settings.diversErrMargin";

  if (Object.keys(errors).length > 0 || maxCents === null || marginPercent === null) {
    return { ok: false, errors };
  }
  return { ok: true, settings: { maxCents, marginPercent } };
}
