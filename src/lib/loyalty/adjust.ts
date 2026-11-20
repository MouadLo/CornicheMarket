// The owner's manual points correction: a signed whole number and a note.
export const MAX_ADJUST_POINTS = 100_000;
export const MAX_NOTE_LENGTH = 200;

export type AdjustCheck =
  | { ok: true; points: number; note: string }
  // A translation key.
  | { ok: false; error: string };

export function checkAdjustment(
  pointsText: string,
  noteText: string,
  balance: number
): AdjustCheck {
  const text = pointsText.trim().replace(/^\+/, "").replace(/^[−–]/, "-");
  if (!/^-?\d{1,6}$/.test(text)) return { ok: false, error: "loyalty.errAdjustPoints" };
  const points = Number(text);
  if (points === 0 || Math.abs(points) > MAX_ADJUST_POINTS) {
    return { ok: false, error: "loyalty.errAdjustPoints" };
  }
  const note = noteText.trim();
  if (note === "" || note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: "loyalty.errAdjustNote" };
  }
  if (balance + points < 0) return { ok: false, error: "loyalty.errAdjustBelowZero" };
  return { ok: true, points, note };
}
