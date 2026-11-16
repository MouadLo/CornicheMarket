// Invoice lines billed by carton or pack, converted into stock units.
// "2 cartons of 12 at 102.00 DH" is received as 24 pieces at 8.50 DH.
// Money stays in integer centimes; the unit cost is rounded half up, so a
// carton whose price does not divide evenly can be off by under a centime per
// piece (100.00 DH / 12 -> 8.33 DH).

export type PackConversion = { quantity: number; unitCostCents: number };

export const MAX_UNITS_PER_BILLING_UNIT = 10_000;

export function validUnitsPerBillingUnit(units: number): boolean {
  return Number.isInteger(units) && units >= 1 && units <= MAX_UNITS_PER_BILLING_UNIT;
}

// Parses what the owner typed in "pieces per carton": a whole number, 1 to 10 000.
export function parseUnitsPerBillingUnit(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const units = Number(trimmed);
  return validUnitsPerBillingUnit(units) ? units : null;
}

export function convertPackLine(
  billedQuantity: number,
  billedUnitCostCents: number,
  unitsPerBillingUnit: number
): PackConversion | null {
  if (
    !validUnitsPerBillingUnit(unitsPerBillingUnit) ||
    !Number.isFinite(billedQuantity) ||
    billedQuantity <= 0 ||
    !Number.isInteger(billedUnitCostCents) ||
    billedUnitCostCents < 0
  )
    return null;
  // Quantities carry at most 3 decimals: work in thousandths to stay exact.
  const thousandths = Math.round(billedQuantity * 1000) * unitsPerBillingUnit;
  const quantity = thousandths / 1000;
  // Round half up with integers only: floor((2c + u) / 2u).
  const unitCostCents = Math.floor(
    (2 * billedUnitCostCents + unitsPerBillingUnit) / (2 * unitsPerBillingUnit)
  );
  return { quantity, unitCostCents };
}

// Weight wording a supplier prints when the quantity column is kilograms.
export function isWeightBillingUnit(unit: string | null | undefined): boolean {
  return !!unit && /^(kg|kgs|kilo|kilos|kilogrammes?|كغ|كلغ|كيلو)\.?$/iu.test(unit.trim());
}

// "carton de 12", "pack 6", "x24", "علبة ١٢": the count printed in the billing
// unit, offered as the pieces-per-pack starting value. Exactly one whole
// number from 2 to 1 000, otherwise nothing (the owner types it).
export function unitsFromBillingUnit(unit: string | null | undefined): number | null {
  if (!unit) return null;
  const western = unit.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 0xf));
  if (/\d[.,]\d/.test(western)) return null;
  const numbers = western.match(/\d+/g);
  if (numbers?.length !== 1) return null;
  const units = Number(numbers[0]);
  return units >= 2 && units <= 1000 ? units : null;
}

// A pack count written in the product name, when no billing unit is printed:
// "COCA-COLA PET 45*12" (45 cl × 12), "6x1,5L", "Eau x24", "pack de 6",
// "carton 12". Only a starting value the owner confirms: a whole number from 2
// to 1 000, or nothing when the name does not say clearly.
export function unitsFromDescription(description: string | null | undefined): number | null {
  if (!description) return null;
  const text = description
    .replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 0xf))
    .toLowerCase();
  const valid = (value: string | undefined) => {
    const units = Number(value);
    return Number.isInteger(units) && units >= 2 && units <= 1000 ? units : null;
  };
  const size = "(?:[.,]\\d+)?\\s*(?:cl|ml|l|lt|g|gr|kg)\\b";
  // "6x1,5L", "12 x 33cl": the count comes before a size.
  const before = text.match(new RegExp(`(?:^|[^\\d.,])(\\d{1,4})\\s*[*x×]\\s*\\d+${size}`, "u"));
  if (before) return valid(before[1]);
  // "45*12", "1.5L x 6", "33cl*24": the count comes after a size or a number.
  const after = text.match(
    /\d(?:[.,]\d+)?\s*(?:cl|ml|l|lt|g|gr|kg)?\s*[*x×]\s*(\d{1,4})(?![\d.,]|\s*(?:cl|ml|l|lt|g|gr|kg)\b)/u
  );
  if (after) return valid(after[1]);
  // "x24", "pack de 6", "carton 12", "lot de 4", "fardeau 6", "علبة 12".
  const word = text.match(
    /(?:^|\s)(?:x|pack|carton|lot|fardeau|paquet|boite|boîte|colis|علبة|كرتون)\s*(?:de\s*)?(\d{1,4})(?![\d.,]|\s*(?:cl|ml|l|lt|g|gr|kg)\b)/u
  );
  return word ? valid(word[1]) : null;
}
