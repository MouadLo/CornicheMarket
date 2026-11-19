import { resolveRange } from "../../src/lib/reports/ranges";
import {
  dayRange,
  dayRangeParams,
  historyRangeParams,
  singleDayOf,
  lastInstantOf,
  nonVoidedTotalCents,
  parseHistoryRange,
} from "../../src/lib/sales/historyRange";
import { fetchRecentSales } from "../../src/lib/sales/queries";

const calls: [string, ...unknown[]][] = [];
jest.mock("../../src/lib/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "gte", "lt", "order", "range"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return name === "range" ? Promise.resolve({ data: [], error: null }) : builder;
    };
  }
  return { supabase: { from: () => builder } };
});

beforeEach(() => {
  calls.length = 0;
});

describe("parseHistoryRange", () => {
  const from = "2026-01-10T00:00:00.000Z";
  const to = "2026-01-11T00:00:00.000Z";

  it("round-trips the report's own instants", () => {
    const range = resolveRange("custom", "2026-01-10", "2026-01-12", "Asia/Tokyo");
    const params = historyRangeParams(range);
    const parsed = parseHistoryRange(params.rangeFrom, params.rangeTo);
    expect(parsed?.from.getTime()).toBe(range.from.getTime());
    expect(parsed?.to.getTime()).toBe(range.to.getTime());
  });

  it("takes the first value of a repeated param", () => {
    expect(parseHistoryRange([from, "junk"], [to])?.to.toISOString()).toBe(to);
  });

  it.each([
    ["missing", undefined, undefined],
    ["only one side", from, undefined],
    ["not a date", "abc", to],
    ["a bare date", "2026-01-10", "2026-01-11"],
    ["an impossible date", "2026-13-45T00:00:00.000Z", to],
    ["empty", "", ""],
    ["inverted", to, from],
    ["empty range", from, from],
    ["absurdly long", "2001-01-01T00:00:00.000Z", "2090-01-01T00:00:00.000Z"],
    ["far past", "1970-01-01T00:00:00.000Z", "1970-01-02T00:00:00.000Z"],
  ])("means no filter when %s", (_name, a, b) => {
    expect(parseHistoryRange(a as string | undefined, b as string | undefined)).toBeNull();
  });

  it("names the last instant inside the half-open range", () => {
    expect(lastInstantOf({ from: new Date(from), to: new Date(to) }).toISOString()).toBe(
      "2026-01-10T23:59:59.999Z"
    );
  });
});

describe("nonVoidedTotalCents", () => {
  it("counts total_cents (already net of the sale discount) and leaves voided sales out", () => {
    // total_cents = lines - discount, as record_sale writes it; report_summary sums it.
    const sales = [
      { total_cents: 1150, voided_at: null }, // 1200 of lines, 50 discount
      { total_cents: 999, voided_at: "2026-01-10T09:30:00Z" },
      { total_cents: 300, voided_at: null },
    ];
    expect(nonVoidedTotalCents(sales)).toBe(1450);
    expect(nonVoidedTotalCents([])).toBe(0);
  });
});

describe("fetchRecentSales range", () => {
  it("filters occurred_at on the half-open [from, to)", async () => {
    const from = new Date("2026-01-10T00:00:00.000Z");
    const to = new Date("2026-01-11T00:00:00.000Z");
    await fetchRecentSales(50, 0, { from, to });
    expect(calls).toContainEqual(["gte", "occurred_at", from.toISOString()]);
    expect(calls).toContainEqual(["lt", "occurred_at", to.toISOString()]);
  });

  it("adds no filter without a range", async () => {
    await fetchRecentSales(50, 0);
    await fetchRecentSales(50, 0, null);
    expect(calls.filter(([name]) => name === "gte" || name === "lt")).toEqual([]);
  });
});

describe("dayRange", () => {
  it("is the store day, half-open, in the store's zone", () => {
    // Lagos is UTC+1 all year. Casablanca's rules differ between time-zone
    // database versions, so its offset would make this test machine-dependent.
    const range = dayRange("2026-11-18", "Africa/Lagos");
    expect(range?.from.toISOString()).toBe("2026-11-17T23:00:00.000Z");
    expect(range?.to.toISOString()).toBe("2026-11-18T23:00:00.000Z");
    const tokyo = dayRange("2026-11-18", "Asia/Tokyo");
    expect(tokyo?.from.toISOString()).toBe("2026-11-17T15:00:00.000Z");
    expect(tokyo?.to.toISOString()).toBe("2026-11-18T15:00:00.000Z");
    const newYork = dayRange("2026-11-18", "America/New_York");
    expect(newYork?.from.toISOString()).toBe("2026-11-18T05:00:00.000Z");
  });

  it("matches the report's own single-day range", () => {
    const report = resolveRange("custom", "2026-06-15", "2026-06-15", "Africa/Casablanca");
    expect(dayRangeParams("2026-06-15", "Africa/Casablanca")).toEqual(historyRangeParams(report));
  });

  it("rejects things that are not a date", () => {
    expect(dayRange("", "UTC")).toBeNull();
    expect(dayRange("2026-02-31", "UTC")).toBeNull();
    expect(dayRangeParams("18/11/2026", "UTC")).toBeNull();
  });

  it("round-trips through singleDayOf, and is empty for longer ranges", () => {
    const key = (iso: string, tz: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
    expect(singleDayOf(dayRange("2026-11-18", "Asia/Tokyo"), "Asia/Tokyo", key)).toBe("2026-11-18");
    expect(singleDayOf(null, "UTC", key)).toBe("");
    const two = resolveRange("custom", "2026-11-17", "2026-11-18", "UTC");
    expect(singleDayOf(two, "UTC", key)).toBe("");
  });
});
