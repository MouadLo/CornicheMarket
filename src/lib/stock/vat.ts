// HT (before TVA) and TTC (TVA included) unit costs, in integer centimes.
// A carton price is converted and divided into pieces in ONE rounding step, so
// "carton of 12 at 102.00 DH HT" is exactly 10.20 DH TTC per piece, with no
// centime lost to rounding twice. Rounding is half up.

import type { PriceBasis } from "@/supabase/functions/_shared/invoiceParse";

export type { PriceBasis };

export function convertUnitCostCents(input: {
  billedCents: number;
  unitsPer: number;
  from: PriceBasis;
  to: PriceBasis;
  vatPercent: number | null;
}): number | null {
  const { billedCents, unitsPer, from, to, vatPercent } = input;
  if (!Number.isInteger(billedCents) || billedCents < 0) return null;
  if (!Number.isInteger(unitsPer) || unitsPer < 1 || unitsPer > 10_000) return null;
  let numerator = billedCents;
  let denominator = unitsPer;
  if (from !== to) {
    if (vatPercent === null || !Number.isInteger(vatPercent) || vatPercent < 0 || vatPercent > 100)
      return null;
    if (from === "ht") numerator *= 100 + vatPercent;
    else denominator *= 100 + vatPercent;
    if (from === "ht") denominator *= 100;
    else numerator *= 100;
  }
  // floor((2n + d) / 2d) is n/d rounded half up, using integers only.
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
