// A camera reports the same barcode many times a second while it stays in
// frame. The same code seen again within this window is ignored; after it, the
// same code is a second item (two identical products in the basket).
export const DUPLICATE_WINDOW_MS = 1000;

export type LastScan = { code: string; at: number } | null;

// `last` is the last scan that was ACCEPTED (not merely seen).
export function shouldAcceptScan(last: LastScan, code: string, now: number): boolean {
  return !(last !== null && last.code === code && now - last.at < DUPLICATE_WINDOW_MS);
}

// What happened to an accepted scan, so the scanner can tell the cashier
// without looking at the screen.
export type ScanStatus = "added" | "unknown" | "error";
export type ScanOutcome = { status: ScanStatus; message: string | null };
