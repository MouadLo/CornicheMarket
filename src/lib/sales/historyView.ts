// Pure helpers for the sales history screen: which store day a sale belongs
// to, the day totals, and the short "first items" preview. Money stays in
// integer centimes; voided sales are listed but never counted in a total.

export type HistorySale = {
  id: string;
  created_at: string;
  occurred_at?: string | null;
  total_cents: number;
  voided_at: string | null;
};

export type DayGroup<S extends HistorySale> = {
  dayKey: string; // YYYY-MM-DD in the store's time zone
  instant: string; // ISO time of the first sale of the day, for the heading
  totalCents: number; // non-voided sales only
  count: number; // non-voided sales only
  sales: S[];
};

// The real sale time (an offline sale is stamped on the device), falling back
// to the row's insert time.
export function saleInstant(sale: HistorySale): string {
  return sale.occurred_at ?? sale.created_at;
}

export function storeDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Groups sales (already newest first) into store days, keeping their order.
export function groupSalesByDay<S extends HistorySale>(
  sales: S[],
  timeZone: string
): DayGroup<S>[] {
  const groups: DayGroup<S>[] = [];
  for (const sale of sales) {
    const instant = saleInstant(sale);
    const dayKey = storeDayKey(instant, timeZone);
    let group = groups.find((g) => g.dayKey === dayKey);
    if (!group) {
      group = { dayKey, instant, totalCents: 0, count: 0, sales: [] };
      groups.push(group);
    }
    group.sales.push(sale);
    if (!sale.voided_at) {
      group.totalCents += sale.total_cents;
      group.count += 1;
    }
  }
  return groups;
}

// First `max` distinct names and how many more there are ("Oil, Rice +3").
export function itemsPreview(names: string[], max = 2): { shown: string[]; more: number } {
  const distinct = [...new Set(names)];
  return { shown: distinct.slice(0, max), more: Math.max(0, distinct.length - max) };
}
