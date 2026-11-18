// Stock home: turns the independent count loads into badge state, and picks
// the card grid's column count. Pure, so both are pinned by tests.

// The Expiring screen opens on this window; the home badge counts the same
// batches (fetchExpiringBatches(EXPIRING_DEFAULT_DAYS), expired ones included).
export const EXPIRING_DEFAULT_DAYS = 30;

// "unknown": the count failed to load, so no badge (never a false 0).
export type CountBadge = { kind: "unknown" } | { kind: "zero" } | { kind: "some"; count: number };

export const UNKNOWN_BADGE: CountBadge = { kind: "unknown" };

export function badgeFromCount(count: number | null | undefined): CountBadge {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return UNKNOWN_BADGE;
  return count === 0 ? { kind: "zero" } : { kind: "some", count };
}

// One settled result per count: a rejection only hides that card's badge.
export function badgeFromSettled(result: PromiseSettledResult<number>): CountBadge {
  return result.status === "fulfilled" ? badgeFromCount(result.value) : UNKNOWN_BADGE;
}

// Columns for the card grid from the width the grid actually has.
export function gridColumns(width: number): 1 | 2 | 3 {
  if (width >= 900) return 3;
  if (width >= 560) return 2;
  return 1;
}
