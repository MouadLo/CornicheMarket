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

describe("parseReceiptJob: receipt after returns", () => {
  const after = () => ({
    originalTotalCents: 2900,
    refundedCents: 1200,
    refundMethods: ["cash", "credit"],
    lastReturnAt: "2026-11-18T09:30:00.000Z",
  });

  it("keeps a valid afterReturns footer, copying only its known fields", () => {
    const model = parseReceiptJob({ ...valid(), afterReturns: { ...after(), note: "x" } });
    expect(model?.afterReturns).toEqual(after());
  });

  it("an updated receipt where everything was returned has no lines", () => {
    const r = { ...valid(), lines: [], subtotalCents: 0, discountCents: 0, totalCents: 0 };
    expect(parseReceiptJob({ ...r, afterReturns: after() })?.lines).toEqual([]);
  });

  it("treats a missing or null afterReturns as a plain receipt", () => {
    expect(parseReceiptJob(valid())).not.toHaveProperty("afterReturns");
    expect(parseReceiptJob({ ...valid(), afterReturns: null })).not.toHaveProperty("afterReturns");
  });

  it.each<[string, Record<string, unknown>]>([
    ["not an object", { afterReturns: "yes" }],
    ["float refund", { afterReturns: { ...after(), refundedCents: 1.5 } }],
    ["negative original", { afterReturns: { ...after(), originalTotalCents: -1 } }],
    ["refund above the original", { afterReturns: { ...after(), refundedCents: 3000 } }],
    ["unknown refund method", { afterReturns: { ...after(), refundMethods: ["bitcoin"] } }],
    ["repeated refund method", { afterReturns: { ...after(), refundMethods: ["cash", "cash"] } }],
    ["methods not an array", { afterReturns: { ...after(), refundMethods: "cash" } }],
    ["bad return date", { afterReturns: { ...after(), lastReturnAt: "soon" } }],
  ])("rejects the whole job when afterReturns is %s", (_name, patch) => {
    expect(parseReceiptJob({ ...valid(), ...patch })).toBeNull();
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

describe("parseReceiptJob: loyalty", () => {
  // valid() has a 0.50 DH discount; give it room for a points discount.
  const base = () => ({ ...valid(), subtotalCents: 2700, discountCents: 1000, totalCents: 1700 });
  const loyalty = () => ({
    discountCents: 800,
    pointsEarned: 12,
    balanceAfterPoints: 252,
    balanceAfterValueCents: 2520,
    pending: false,
  });
  const parse = (patch: Record<string, unknown> | null | undefined) => {
    const r = base() as Record<string, unknown>;
    if (patch === undefined) return parseReceiptJob(r);
    r.loyalty = patch === null ? null : { ...loyalty(), ...patch };
    return parseReceiptJob(r);
  };

  it("absent or null is a plain receipt", () => {
    expect(parse(undefined)).not.toBeNull();
    expect(parse(undefined)).not.toHaveProperty("loyalty");
    expect(parse(null)).not.toBeNull();
    expect(parse(null)).not.toHaveProperty("loyalty");
  });

  it("accepts a well-formed block and copies only its known fields", () => {
    const r = base() as Record<string, unknown>;
    r.loyalty = { ...loyalty(), phone: "+212612345678", cardToken: "secret" };
    const model = parseReceiptJob(r);
    expect(model?.loyalty).toEqual(loyalty());
    expect(JSON.stringify(model)).not.toContain("secret");
  });

  it("accepts nulls for what is unknown, and a pending member", () => {
    expect(
      parse({ pointsEarned: null, balanceAfterPoints: null, balanceAfterValueCents: null })
    ).not.toBeNull();
    expect(
      parse({
        discountCents: 0,
        balanceAfterPoints: null,
        balanceAfterValueCents: null,
        pending: true,
      })?.loyalty?.pending
    ).toBe(true);
  });

  it("the points discount can equal the receipt's discount but not exceed it", () => {
    expect(parse({ discountCents: 1000 })).not.toBeNull();
    expect(parse({ discountCents: 1001 })).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ["float discount", { discountCents: 10.5 }],
    ["negative discount", { discountCents: -1 }],
    ["string discount", { discountCents: "800" }],
    ["float points", { pointsEarned: 1.5 }],
    ["negative points", { pointsEarned: -3 }],
    ["huge points", { pointsEarned: 2_000_000_000 }],
    ["string points", { balanceAfterPoints: "252" }],
    ["float balance value", { balanceAfterValueCents: 2.5 }],
    ["balance points without value", { balanceAfterValueCents: null }],
    ["balance value without points", { balanceAfterPoints: null }],
    ["pending not a boolean", { pending: "yes" }],
    ["pending missing", { pending: undefined }],
  ])("a malformed block (%s) makes the whole job invalid", (_name, patch) => {
    expect(parse(patch)).toBeNull();
  });

  it("a loyalty block that is not an object makes the job invalid", () => {
    for (const value of ["x", 5, [], true]) {
      const r = base() as Record<string, unknown>;
      r.loyalty = value;
      expect(parseReceiptJob(r)).toBeNull();
    }
  });
});
