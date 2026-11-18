// Pure rules for the stock count screen: merging loaded lists into the count,
// progress, the "not counted yet" filter, batching and the confirmation
// summary. Kept out of the screen so each rule is pinned by a test.
import { parseQuantity } from "@/src/lib/money";
import type { Product } from "@/src/lib/products/queries";

export type CountLine = {
  product: Product;
  counted: string;
  operationId?: string;
  applied?: { delta: number } | { error: string };
};

// How many stock corrections are in flight at once. A category can hold 100+
// lines; one request per line all at once would flood a shop's connection.
export const APPLY_BATCH_SIZE = 5;

// Above this many lines the confirmation shows a summary, not every line, so
// its buttons stay on screen.
export const CONFIRM_FULL_LIST_MAX = 8;
export const CONFIRM_PREVIEW_LINES = 5;

// The counted quantity, or null while nobody has typed one. An empty box (or
// one holding only spaces) is "not counted", NEVER zero: only an explicitly
// typed number counts, and a typed 0 is a real count of zero.
export function countedQuantity(line: Pick<CountLine, "counted">): number | null {
  if (line.counted.trim() === "") return null;
  return parseQuantity(line.counted);
}

export function isCounted(line: Pick<CountLine, "counted">): boolean {
  return countedQuantity(line) !== null;
}

export function isApplied(line: CountLine): boolean {
  return Boolean(line.applied && "delta" in line.applied);
}

// Lines that would be sent: counted, and not already applied.
export function isEligible(line: CountLine): boolean {
  return isCounted(line) && !isApplied(line);
}

// Typed but not yet applied: leaving the screen would lose it.
export function hasUnsavedWork(lines: CountLine[]): boolean {
  return lines.some(isEligible);
}

// Adds products to the count. A product already there is left exactly as it
// is (typed quantity, operation id, applied state), so loading a list twice,
// or after typing, never overwrites work or duplicates a line.
export function mergeProducts(lines: CountLine[], products: Product[]): CountLine[] {
  const seen = new Set(lines.map((line) => line.product.id));
  const added: CountLine[] = [];
  for (const product of products) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    added.push({ product, counted: "" });
  }
  return added.length === 0 ? lines : [...lines, ...added];
}

export type CountProgress = { counted: number; total: number };

export function countProgress(lines: CountLine[]): CountProgress {
  return { counted: lines.filter(isCounted).length, total: lines.length };
}

// The lines to show. With "not counted yet" on, counted lines are hidden, except
// the one being worked on (keepId) so a line does not vanish under the cursor
// the moment its first digit is typed.
export function visibleLines(
  lines: CountLine[],
  onlyUncounted: boolean,
  keepId: string | null
): CountLine[] {
  if (!onlyUncounted) return lines;
  return lines.filter((line) => !isCounted(line) || line.product.id === keepId);
}

export type ConfirmPreview = {
  total: number;
  differing: number;
  // Everything when short; otherwise the first few that change stock.
  shown: CountLine[];
  hidden: number;
  summaryOnly: boolean;
};

export function confirmPreview(batch: CountLine[]): ConfirmPreview {
  const differs = (line: CountLine) => countedQuantity(line) !== line.product.stock_quantity;
  const differing = batch.filter(differs);
  if (batch.length <= CONFIRM_FULL_LIST_MAX) {
    return {
      total: batch.length,
      differing: differing.length,
      shown: batch,
      hidden: 0,
      summaryOnly: false,
    };
  }
  const shown = differing.slice(0, CONFIRM_PREVIEW_LINES);
  return {
    total: batch.length,
    differing: differing.length,
    shown,
    hidden: differing.length - shown.length,
    summaryOnly: true,
  };
}

// Runs worker over items a few at a time, in order, and returns the results in
// the same order. The worker must settle (the screen's catches failures per
// line); one batch finishes before the next starts.
export async function runInBatches<T, R>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const step = Math.max(1, Math.floor(size));
  const results: R[] = [];
  for (let start = 0; start < items.length; start += step) {
    results.push(...(await Promise.all(items.slice(start, start + step).map(worker))));
  }
  return results;
}
