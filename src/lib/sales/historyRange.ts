// The date range the sales history can be opened on from a report. The range
// travels as two route params holding the SAME instants the report used
// (half-open [from, to), see resolveRange in src/lib/reports/ranges.ts).

export type HistoryRange = { from: Date; to: Date };

type Param = string | string[] | undefined;

export const HISTORY_RANGE_FROM = "rangeFrom";
export const HISTORY_RANGE_TO = "rangeTo";

// Anything older or longer than this is not a report range a person can pick.
const MIN_TIME = Date.UTC(2000, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);
const MAX_SPAN_MS = 400 * 24 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function one(param: Param): string | null {
  const value = Array.isArray(param) ? param[0] : param;
  return typeof value === "string" ? value : null;
}

// Invalid or partial params mean "no filter", never an error.
export function parseHistoryRange(from: Param, to: Param): HistoryRange | null {
  const fromText = one(from);
  const toText = one(to);
  if (!fromText || !toText || !ISO.test(fromText) || !ISO.test(toText)) return null;
  const fromTime = new Date(fromText).getTime();
  const toTime = new Date(toText).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return null;
  if (fromTime < MIN_TIME || toTime > MAX_TIME) return null;
  if (toTime <= fromTime || toTime - fromTime > MAX_SPAN_MS) return null;
  return { from: new Date(fromTime), to: new Date(toTime) };
}

export function historyRangeParams(range: HistoryRange): Record<string, string> {
  return {
    [HISTORY_RANGE_FROM]: range.from.toISOString(),
    [HISTORY_RANGE_TO]: range.to.toISOString(),
  };
}

// What the report calls revenue: the sum of the sales' totals (already net of
// the sale discount), voided sales left out.
export function nonVoidedTotalCents(sales: { total_cents: number; voided_at: string | null }[]) {
  let total = 0;
  for (const sale of sales) if (!sale.voided_at) total += sale.total_cents;
  return total;
}

// The last instant inside the half-open range, to name its last day.
export function lastInstantOf(range: HistoryRange): Date {
  return new Date(range.to.getTime() - 1);
}
