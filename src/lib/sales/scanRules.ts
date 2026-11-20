// What happened to an accepted scan, so the scanner can tell the cashier
// without looking at the screen.
export type ScanStatus = "added" | "unknown" | "error";
export type ScanOutcome = { status: ScanStatus; message: string | null };
