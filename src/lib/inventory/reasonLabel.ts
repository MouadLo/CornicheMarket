// Adjustment reasons are stored in the database as fixed English codes
// ('damaged', 'count_correction', ...). Those codes never change; they are
// translated here, at display time only. An unknown code (a reason added
// later, or an old row) falls back to the raw value so nothing is hidden.
type Translate = (key: string) => string;

const KNOWN_REASONS = ["damaged", "expired", "theft", "count_correction"];

export function reasonLabel(reason: string, t: Translate): string {
  return KNOWN_REASONS.includes(reason) ? t(`adjustReasons.${reason}`) : reason;
}
