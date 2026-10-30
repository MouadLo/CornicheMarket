import { parseQuantity } from "@/src/lib/money";

// Text entry for the weight keypad. The pad keeps the raw string the cashier
// has pressed and only parses once, on OK -- re-parsing on every key is what
// made the old kg field swallow the "." (typing "0." parsed to 0, which was
// shown back as "0").
export type WeightKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

// sale_items.quantity is numeric(12,3): grams. Two integer digits keeps a
// weighed line under 100 kg, far above anything sold over a counter scale.
const MAX_INTEGER_DIGITS = 2;
const MAX_DECIMALS = 3;

export function pressKey(entry: string, key: WeightKey): string {
  if (key === "back") return entry.slice(0, -1);

  if (key === ".") {
    if (entry.includes(".")) return entry;
    return entry === "" ? "0." : `${entry}.`;
  }

  if (entry.includes(".")) {
    const decimals = entry.split(".")[1];
    return decimals.length >= MAX_DECIMALS ? entry : entry + key;
  }

  // A lone "0" is replaced rather than stacked ("07" is just 7).
  if (entry === "0") return key === "0" ? entry : key;
  if (entry.length >= MAX_INTEGER_DIGITS) return entry;
  return entry + key;
}

// Null while there is nothing chargeable yet: empty, or still zero.
export function entryToQuantity(entry: string): number | null {
  const quantity = parseQuantity(entry);
  return quantity !== null && quantity > 0 ? quantity : null;
}

// Physical keyboard on web. Digits, "." or "," for the decimal point,
// Backspace, Enter (add) and Escape (cancel). Anything else is left alone.
export type PadKeyboardKey = WeightKey | "enter" | "escape";

export function keyFromKeyboardEvent(key: string): PadKeyboardKey | null {
  if (key.length === 1 && key >= "0" && key <= "9") return key as WeightKey;
  if (key === "." || key === ",") return ".";
  if (key === "Backspace") return "back";
  if (key === "Enter") return "enter";
  if (key === "Escape") return "escape";
  return null;
}

// A USB/Bluetooth scanner "types" its barcode a few milliseconds per key and
// ends with Enter. No person types two keys that close together, so keys that
// arrive faster than this are a scanner, not the cashier. Without this, a
// barcode scanned while the pad is open would fill the pad and its Enter
// would add a garbage weight.
const SCANNER_GAP_MS = 35;

export function isScannerBurst(previousAt: number | null, now: number): boolean {
  return previousAt !== null && now - previousAt < SCANNER_GAP_MS;
}
