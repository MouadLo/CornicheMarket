import {
  groupSalesByDay,
  itemsPreview,
  parseVoidReason,
  saleInstant,
  storeDayKey,
} from "../../src/lib/sales/historyView";

const sale = (id: string, at: string, total: number, voided = false) => ({
  id,
  created_at: at,
  total_cents: total,
  voided_at: voided ? at : null,
});

describe("storeDayKey", () => {
  it("uses the store's time zone for the day boundary", () => {
    // 23:30 UTC is already the next day in Tokyo (UTC+9, no daylight saving)
    // but not in UTC. A fixed-offset zone keeps this independent of the
    // machine's tz database (Morocco's offset changes around Ramadan, and CI's
    // data differs from a laptop's).
    expect(storeDayKey("2026-11-16T23:30:00Z", "UTC")).toBe("2026-11-16");
    expect(storeDayKey("2026-11-16T23:30:00Z", "Asia/Tokyo")).toBe("2026-11-17");
  });
});

describe("groupSalesByDay", () => {
  it("groups newest-first sales by store day and totals in centimes", () => {
    const groups = groupSalesByDay(
      [
        sale("a", "2026-11-17T10:00:00Z", 1250),
        sale("b", "2026-11-17T09:00:00Z", 700),
        sale("c", "2026-11-16T15:00:00Z", 300),
      ],
      "UTC"
    );
    expect(groups.map((g) => [g.dayKey, g.totalCents, g.count])).toEqual([
      ["2026-11-17", 1950, 2],
      ["2026-11-16", 300, 1],
    ]);
  });

  it("lists voided sales but leaves them out of the total", () => {
    const [group] = groupSalesByDay(
      [sale("a", "2026-11-17T10:00:00Z", 1000), sale("b", "2026-11-17T09:00:00Z", 999, true)],
      "UTC"
    );
    expect(group.sales).toHaveLength(2);
    expect(group.totalCents).toBe(1000);
    expect(group.count).toBe(1);
  });

  it("prefers occurred_at over created_at", () => {
    const s = { ...sale("a", "2026-11-18T01:00:00Z", 100), occurred_at: "2026-11-17T20:00:00Z" };
    expect(saleInstant(s)).toBe("2026-11-17T20:00:00Z");
    expect(groupSalesByDay([s], "UTC")[0].dayKey).toBe("2026-11-17");
  });

  it("returns nothing for no sales", () => {
    expect(groupSalesByDay([], "UTC")).toEqual([]);
  });
});

describe("itemsPreview", () => {
  it("shows the first two names and how many more", () => {
    expect(itemsPreview(["Oil", "Rice", "Tea", "Salt"])).toEqual({
      shown: ["Oil", "Rice"],
      more: 2,
    });
  });
  it("counts a repeated product once", () => {
    expect(itemsPreview(["Oil", "Oil", "Rice"])).toEqual({ shown: ["Oil", "Rice"], more: 0 });
  });
  it("handles an empty list", () => {
    expect(itemsPreview([])).toEqual({ shown: [], more: 0 });
  });
});

describe("parseVoidReason", () => {
  it("reads a reason written by an approved void request", () => {
    expect(parseVoidReason("wrong_quantity (requested by Amina Cashier)")).toEqual({
      code: "wrong_quantity",
      note: null,
      requestedBy: "Amina Cashier",
    });
    expect(parseVoidReason("other - client a payé deux fois (requested by Amina)")).toEqual({
      code: "other",
      note: "client a payé deux fois",
      requestedBy: "Amina",
    });
  });

  it("leaves a reason typed by the owner alone", () => {
    expect(parseVoidReason("retour client")).toBeNull();
    expect(parseVoidReason(null)).toBeNull();
  });
});
