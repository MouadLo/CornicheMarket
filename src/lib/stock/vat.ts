// HT (before TVA) and TTC (TVA included) unit costs, in integer centimes.
// A carton price is discounted, converted and divided into pieces in ONE
// rounding step, so "carton of 12 at 102.00 DH HT" is exactly 10.20 DH TTC per
// piece, with no centime lost to rounding twice. Rounding is half up.

import type { PriceBasis } from "@/supabase/functions/_shared/invoiceParse";

export type { PriceBasis };

// A line discount, on the same basis (HT or TTC) as the printed price.
// "percent": hundredths of a percent (10% = 1000). "amount": centimes taken off
// the whole line, which bills `quantityMilli` thousandths of a unit.
export type LineDiscount =
  | { kind: "percent"; hundredths: number }
  | { kind: "amount"; cents: number; quantityMilli: number };

// A discount on the whole invoice: a percentage in hundredths, or an amount
// off the lines' sum (`linesTotalCents`), both on the printed price basis. Every
// line's cost is reduced by the same ratio.
export type GlobalDiscount =
  | { kind: "percent"; hundredths: number }
  | { kind: "amount"; cents: number; linesTotalCents: number };

export function convertUnitCostCents(input: {
  billedCents: number;
  unitsPer: number;
  from: PriceBasis;
  to: PriceBasis;
  vatPercent: number | null;
  discount?: LineDiscount | null;
  globalDiscount?: GlobalDiscount | null;
}): number | null {
  const { billedCents, unitsPer, from, to, vatPercent, discount, globalDiscount } = input;
  if (!Number.isInteger(billedCents) || billedCents < 0) return null;
  if (!Number.isInteger(unitsPer) || unitsPer < 1 || unitsPer > 10_000) return null;
  // BigInt: an amount discount multiplies a price by a quantity in thousandths.
  let numerator = BigInt(billedCents);
  let denominator = BigInt(unitsPer);
  if (discount?.kind === "percent") {
    if (
      !Number.isInteger(discount.hundredths) ||
      discount.hundredths < 0 ||
      discount.hundredths > 10_000
    )
      return null;
    numerator *= BigInt(10_000 - discount.hundredths);
    denominator *= BigInt(10_000);
  } else if (discount?.kind === "amount") {
    const { cents, quantityMilli } = discount;
    if (!Number.isInteger(cents) || cents < 0) return null;
    if (!Number.isInteger(quantityMilli) || quantityMilli < 1) return null;
    const net = numerator * BigInt(quantityMilli) - BigInt(cents) * BigInt(1000);
    // A discount larger than the line itself is a misreading, not a negative cost.
    if (net < BigInt(0)) return null;
    numerator = net;
    denominator *= BigInt(quantityMilli);
  }
  if (globalDiscount?.kind === "percent") {
    const h = globalDiscount.hundredths;
    if (!Number.isInteger(h) || h < 0 || h > 10_000) return null;
    numerator *= BigInt(10_000 - h);
    denominator *= BigInt(10_000);
  } else if (globalDiscount?.kind === "amount") {
    const { cents, linesTotalCents } = globalDiscount;
    if (!Number.isInteger(cents) || cents < 0) return null;
    if (!Number.isInteger(linesTotalCents) || linesTotalCents < 1 || cents > linesTotalCents)
      return null;
    numerator *= BigInt(linesTotalCents - cents);
    denominator *= BigInt(linesTotalCents);
  }
  if (from !== to) {
    if (vatPercent === null || !Number.isInteger(vatPercent) || vatPercent < 0 || vatPercent > 100)
      return null;
    if (from === "ht") {
      numerator *= BigInt(100 + vatPercent);
      denominator *= BigInt(100);
    } else {
      denominator *= BigInt(100 + vatPercent);
      numerator *= BigInt(100);
    }
  }
  // floor((2n + d) / 2d) is n/d rounded half up, using integers only.
  return Number((BigInt(2) * numerator + denominator) / (BigInt(2) * denominator));
}
