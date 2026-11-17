/**
 * C07: the receive screen accepted any string shaped like YYYY-MM-DD
 * (2026-02-31 included) and silently turned every other spelling, the
 * natural 31/03/2026 included, into "no expiry". These pin the replacement:
 * real calendar dates only, DD/MM/YYYY accepted, and a bad date makes the
 * line invalid instead of quietly dropping the expiry.
 */
import { buildReceivePayload, normalizeExpiryDate } from "../../src/lib/stock/receive";

describe("normalizeExpiryDate", () => {
  it("treats an empty field as no expiry", () => {
    expect(normalizeExpiryDate("")).toEqual({ ok: true, value: null });
    expect(normalizeExpiryDate("   ")).toEqual({ ok: true, value: null });
  });

  it("accepts a real ISO date", () => {
    expect(normalizeExpiryDate("2026-03-31")).toEqual({ ok: true, value: "2026-03-31" });
  });

  it("rejects a date that does not exist", () => {
    expect(normalizeExpiryDate("2026-02-31")).toEqual({ ok: false });
    expect(normalizeExpiryDate("2026-13-01")).toEqual({ ok: false });
    expect(normalizeExpiryDate("2026-00-10")).toEqual({ ok: false });
  });

  it("knows leap years", () => {
    expect(normalizeExpiryDate("2028-02-29")).toEqual({ ok: true, value: "2028-02-29" });
    expect(normalizeExpiryDate("2027-02-29")).toEqual({ ok: false });
  });

  it("accepts day/month/year, the way dates are written in Morocco", () => {
    expect(normalizeExpiryDate("31/03/2026")).toEqual({ ok: true, value: "2026-03-31" });
    expect(normalizeExpiryDate("5/4/2026")).toEqual({ ok: true, value: "2026-04-05" });
    expect(normalizeExpiryDate("31/02/2026")).toEqual({ ok: false });
  });

  it("rejects anything else instead of silently dropping it", () => {
    expect(normalizeExpiryDate("tomorrow")).toEqual({ ok: false });
    expect(normalizeExpiryDate("2026-3-31")).toEqual({ ok: false });
    expect(normalizeExpiryDate("31/03/26")).toEqual({ ok: false });
  });
});

const product = (id: string) => ({ id });

describe("buildReceivePayload", () => {
  it("builds lines in centimes and integer-safe quantities", () => {
    const { lines, invalidCount } = buildReceivePayload([
      {
        product: product("a"),
        quantity: "24",
        unitCost: "4.17",
        expiryDate: "",
        newSellingPriceCents: null,
      },
      {
        product: product("b"),
        quantity: "1,250",
        unitCost: "60",
        expiryDate: "31/03/2026",
        newSellingPriceCents: null,
      },
    ]);
    expect(invalidCount).toBe(0);
    expect(lines).toEqual([
      { product_id: "a", quantity: 24, unit_cost_cents: 417, expiry_date: null },
      { product_id: "b", quantity: 1.25, unit_cost_cents: 6000, expiry_date: "2026-03-31" },
    ]);
  });

  it("a line with an impossible expiry date is invalid, not saved without its date", () => {
    const { lines, invalidCount } = buildReceivePayload([
      {
        product: product("a"),
        quantity: "5",
        unitCost: "5",
        expiryDate: "2026-02-31",
        newSellingPriceCents: null,
      },
    ]);
    expect(lines).toEqual([]);
    expect(invalidCount).toBe(1);
  });

  it("lines without quantity or cost are invalid", () => {
    const { invalidCount } = buildReceivePayload([
      {
        product: product("a"),
        quantity: "",
        unitCost: "5",
        expiryDate: "",
        newSellingPriceCents: null,
      },
      {
        product: product("b"),
        quantity: "0",
        unitCost: "5",
        expiryDate: "",
        newSellingPriceCents: null,
      },
      {
        product: product("c"),
        quantity: "2",
        unitCost: "",
        expiryDate: "",
        newSellingPriceCents: null,
      },
    ]);
    expect(invalidCount).toBe(3);
  });

  it("collects selling-price changes from valid lines only, so they travel with the delivery", () => {
    const { priceUpdates } = buildReceivePayload([
      {
        product: product("a"),
        quantity: "5",
        unitCost: "5",
        expiryDate: "",
        newSellingPriceCents: 800,
      },
      {
        product: product("b"),
        quantity: "",
        unitCost: "5",
        expiryDate: "",
        newSellingPriceCents: 900,
      },
      {
        product: product("c"),
        quantity: "5",
        unitCost: "5",
        expiryDate: "",
        newSellingPriceCents: null,
      },
    ]);
    expect(priceUpdates).toEqual([{ product_id: "a", selling_price_cents: 800 }]);
  });
});

describe("buildReceivePayload names the lines it cannot save (O3)", () => {
  it("reports each incomplete line with every reason", () => {
    const { lines, invalid } = buildReceivePayload([
      {
        product: { id: "a", name: "Sidi Ali 1.5L" },
        quantity: "6",
        unitCost: "4.50",
        expiryDate: "",
        newSellingPriceCents: null,
      },
      {
        product: { id: "b", name: "Lait Centrale" },
        quantity: "0",
        unitCost: "",
        expiryDate: "",
        newSellingPriceCents: null,
      },
      {
        product: { id: "c", name: "Danone" },
        quantity: "12",
        unitCost: "2",
        expiryDate: "31/02/2027",
        newSellingPriceCents: null,
      },
    ]);
    expect(lines.map((line) => line.product_id)).toEqual(["a"]);
    expect(invalid).toEqual([
      { productId: "b", name: "Lait Centrale", problems: ["quantity", "cost"] },
      { productId: "c", name: "Danone", problems: ["expiry"] },
    ]);
  });

  it("reports nothing when every line is complete", () => {
    const { invalid } = buildReceivePayload([
      {
        product: { id: "a", name: "Sidi Ali 1.5L" },
        quantity: "6",
        unitCost: "4.50",
        expiryDate: "",
        newSellingPriceCents: null,
      },
    ]);
    expect(invalid).toEqual([]);
  });
});
