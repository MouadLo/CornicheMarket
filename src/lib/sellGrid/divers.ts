// The free-amount "Divers" item, as pure functions: the amount keypad's text
// entry, the limit rules, the note, and the cart line. Money is integer centimes.
import { parseMoneyToCents } from "@/src/lib/money";
import { cartLineFrom, type CartLine } from "@/src/lib/sales/totals";
import type { WeightKey } from "@/src/lib/sales/weightEntry";

// sale_items.note and record_sale both stop at 60 characters.
export const DIVERS_NOTE_MAX = 60;
// Six integer digits is 999 999.99 DH: far above any counter sale, and well
// inside a bigint of centimes.
const MAX_INTEGER_DIGITS = 6;
const MAX_DECIMALS = 2;

// What the device knows about the built-in Divers product (kept in the offline
// cache). Never holds cost or margin: the cache is read on cashier devices.
export type DiversConfig = {
  productId: string;
  // store_settings.divers_max_cents: what a cashier may ring up in one line.
  maxCents: number;
};

// A usable config from a stored value, or null (missing, malformed): the tile
// is then hidden rather than broken.
export function parseDiversConfig(raw: unknown): DiversConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { productId, maxCents } = raw as { productId?: unknown; maxCents?: unknown };
  if (typeof productId !== "string" || productId.length === 0) return null;
  if (!Number.isSafeInteger(maxCents) || (maxCents as number) <= 0) return null;
  return { productId, maxCents: maxCents as number };
}

// The cashier's maximum; the owner has none (null).
export function diversLimitFor(isOwner: boolean, maxCents: number): number | null {
  return isOwner ? null : maxCents;
}

// Keypad text entry: digits and one decimal point, two decimals at most.
export function pressAmountKey(entry: string, key: WeightKey): string {
  if (key === "back") return entry.slice(0, -1);

  if (key === ".") {
    if (entry.includes(".")) return entry;
    return entry === "" ? "0." : `${entry}.`;
  }

  if (entry.includes(".")) {
    return entry.split(".")[1].length >= MAX_DECIMALS ? entry : entry + key;
  }
  // A lone "0" is replaced rather than stacked ("07" is just 7).
  if (entry === "0") return key === "0" ? entry : key;
  if (entry.length >= MAX_INTEGER_DIGITS) return entry;
  return entry + key;
}

// Null while nothing chargeable is typed (empty or zero).
export function entryToCents(entry: string): number | null {
  if (entry.trim() === "") return null;
  const cents = parseMoneyToCents(entry);
  return cents !== null && cents > 0 ? cents : null;
}

export type DiversAmountProblem = "empty" | "over";

// Why "Ajouter" is disabled, or null when the amount can be added.
export function diversAmountProblem(
  cents: number | null,
  limitCents: number | null
): DiversAmountProblem | null {
  if (cents === null || cents <= 0) return "empty";
  if (limitCents !== null && cents > limitCents) return "over";
  return null;
}

// The note as sent: trimmed, at most 60 characters, null when there is none.
export function cleanDiversNote(raw: string): string | null {
  const note = raw.trim().slice(0, DIVERS_NOTE_MAX).trim();
  return note === "" ? null : note;
}

// A Divers line: quantity 1, the typed amount, loyalty.misc set (never earns or
// spends points), its own key so it is never merged, and its note.
export function diversCartLine(
  config: DiversConfig,
  entry: { amountCents: number; note: string | null; name: string; key: string }
): CartLine {
  const line = cartLineFrom(
    {
      id: config.productId,
      name: entry.name,
      unit: "piece",
      selling_price_cents: entry.amountCents,
      kind: "misc",
    },
    1
  );
  return { ...line, key: entry.key, ...(entry.note ? { note: entry.note } : {}) };
}

// Always a new line: two Divers items are two amounts, each with its own note.
export function addDiversLine(lines: CartLine[], line: CartLine): CartLine[] {
  return [...lines, line];
}
