import type { CartLine } from "@/src/lib/sales/totals";

// Undo for removing lines from the basket (UX C11). The basket may have
// changed since the removal, so restoring never overwrites it: a product that
// is in the basket again is left as it is now (skipped, not merged or
// duplicated), because what the cashier did last is what they want.

// Put one removed line back at its old position (or the end if the basket is
// now shorter). Skipped if that product is already in the basket.
export function restoreLine(current: CartLine[], line: CartLine, index: number): CartLine[] {
  if (current.some((other) => other.product_id === line.product_id)) return current;
  const at = Math.max(0, Math.min(index, current.length));
  return [...current.slice(0, at), line, ...current.slice(at)];
}

// Put back every line of an emptied basket, in their old order and before any
// line added since. Products already in the basket again are skipped.
export function restoreLines(current: CartLine[], removed: CartLine[]): CartLine[] {
  const present = new Set(current.map((line) => line.product_id));
  return [...removed.filter((line) => !present.has(line.product_id)), ...current];
}

// The sale discount comes back only if none was typed since.
export function restoreSaleDiscount(current: string, previous: string): string {
  return current.trim() === "" ? previous : current;
}
