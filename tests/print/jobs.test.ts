import {
  STALE_AFTER_MS,
  cashierLabelFor,
  isStale,
  jobReceiptNumber,
  needsManualAction,
  normalizeLanguage,
  parseReceiptJob,
  phoneStateOf,
  stationStats,
} from "../../src/lib/print/jobs";

const valid = () => ({
  shopName: "Corniche Market",
  receiptNumber: "ABCDEF12",
  occurredAt: "2026-11-17T10:00:00.000Z",
  cashierName: "Sara",
  lines: [
    {
      name: "Milk",
      quantity: 2.5,
      unit: "kg",
      unitPriceCents: 700,
      discountCents: 50,
      totalCents: 1700,
    },
  ],
  subtotalCents: 1750,
  discountCents: 50,
  totalCents: 1700,
  paymentMethod: "cash",
  customerName: null,
  cashReceivedCents: 2000,
  changeCents: 300,
});

describe("parseReceiptJob", () => {
  it("accepts a well-formed receipt and copies only known fields", () => {
    const model = parseReceiptJob({ ...valid(), html: "<script>x</script>" });
    expect(model).toEqual(valid());
    expect(model).not.toHaveProperty("html");
  });

  it.each([
    ["not an object", "x"],
    ["array", []],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(parseReceiptJob(value)).toBeNull();
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["missing shop", (r) => delete r.shopName],
    ["shop too long", (r) => (r.shopName = "x".repeat(81))],
    ["bad date", (r) => (r.occurredAt = "not a date")],
    ["float cents", (r) => (r.totalCents = 10.5)],
    ["negative cents", (r) => (r.totalCents = -1)],
    ["string cents", (r) => (r.totalCents = "10")],
    ["unknown payment", (r) => (r.paymentMethod = "bitcoin")],
    ["lines not an array", (r) => (r.lines = {})],
    ["cashier not a string", (r) => (r.cashierName = 5)],
    ["cash received float", (r) => (r.cashReceivedCents = 1.5)],
    ["cash received undefined", (r) => delete r.cashReceivedCents],
  ])("rejects %s", (_name, mutate) => {
    const r = valid() as Record<string, unknown>;
    mutate(r);
    expect(parseReceiptJob(r)).toBeNull();
  });

  it("validates every line", () => {
    const bad = (patch: Record<string, unknown>) => {
      const r = valid();
      r.lines = [{ ...r.lines[0], ...patch }];
      return parseReceiptJob(r);
    };
    expect(bad({})).not.toBeNull();
    expect(bad({ quantity: 0 })).toBeNull();
    expect(bad({ quantity: 1.2345 })).toBeNull();
    expect(bad({ quantity: "1" })).toBeNull();
    expect(bad({ unit: 3 })).toBeNull();
    expect(bad({ unit: null })).not.toBeNull();
    expect(bad({ name: "x".repeat(201) })).toBeNull();
    expect(bad({ unitPriceCents: 1.5 })).toBeNull();
    expect(bad({ discountCents: -5 })).toBeNull();
  });

  it("caps the number of lines at 200", () => {
    const r = valid();
    const line = r.lines[0];
    r.lines = Array.from({ length: 200 }, () => line);
    expect(parseReceiptJob(r)).not.toBeNull();
    r.lines = Array.from({ length: 201 }, () => line);
    expect(parseReceiptJob(r)).toBeNull();
  });
});

describe("staleness and manual actions", () => {
  const now = Date.parse("2026-11-17T10:10:00.000Z");
  it("is stale after 2 minutes", () => {
    expect(isStale(new Date(now - STALE_AFTER_MS).toISOString(), now)).toBe(false);
    expect(isStale(new Date(now - STALE_AFTER_MS - 1).toISOString(), now)).toBe(true);
  });
  it("offers Print/Ignore for failed and stale pending jobs only", () => {
    const old = new Date(now - 5 * 60_000).toISOString();
    const fresh = new Date(now - 10_000).toISOString();
    expect(needsManualAction({ status: "failed", created_at: fresh }, now)).toBe(true);
    expect(needsManualAction({ status: "pending", created_at: old }, now)).toBe(true);
    expect(needsManualAction({ status: "pending", created_at: fresh }, now)).toBe(false);
    expect(needsManualAction({ status: "printed", created_at: old }, now)).toBe(false);
    expect(needsManualAction({ status: "printing", created_at: old }, now)).toBe(false);
  });
});

describe("phone status", () => {
  it("maps server statuses to what the phone shows", () => {
    expect(phoneStateOf("pending")).toBe("queued");
    expect(phoneStateOf("printing")).toBe("printing");
    expect(phoneStateOf("printed")).toBe("printed");
    expect(phoneStateOf("failed")).toBe("failed");
    expect(phoneStateOf("cancelled")).toBe("failed");
  });
});

describe("labels and stats", () => {
  it("picks the cashier label with fallbacks and a 60 character cap", () => {
    expect(cashierLabelFor(" Sara ", "Other")).toBe("Sara");
    expect(cashierLabelFor("", "Other")).toBe("Other");
    expect(cashierLabelFor(null, null)).toBe("Caisse");
    expect(cashierLabelFor("x".repeat(100), null)).toHaveLength(60);
  });
  it("normalizes the language", () => {
    expect(normalizeLanguage("en-US")).toBe("en");
    expect(normalizeLanguage("ar")).toBe("ar");
    expect(normalizeLanguage("es")).toBe("fr");
    expect(normalizeLanguage(undefined)).toBe("fr");
  });
  it("counts what was printed today and finds the last print", () => {
    const now = new Date(2026, 10, 17, 15, 0, 0);
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).toISOString();
    const stats = stationStats(
      [
        { status: "printed", printed_at: at(17, 9) },
        { status: "printed", printed_at: at(17, 12) },
        { status: "printed", printed_at: at(16, 20) },
        { status: "failed", printed_at: null },
      ],
      now
    );
    expect(stats.printedToday).toBe(2);
    expect(stats.lastPrintedAt).toBe(at(17, 12));
    expect(stationStats([], now)).toEqual({ printedToday: 0, lastPrintedAt: null });
  });
  it("reads the receipt number safely", () => {
    expect(jobReceiptNumber({ receipt: { receiptNumber: "AB12" } })).toBe("AB12");
    expect(jobReceiptNumber({ receipt: {} })).toBe("—");
    expect(jobReceiptNumber({ receipt: null })).toBe("—");
  });
});
