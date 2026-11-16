import { convertUnitCostCents } from "@/src/lib/stock/vat";

const convert = (
  billedCents: number,
  from: "ht" | "ttc",
  to: "ht" | "ttc",
  vatPercent: number | null,
  unitsPer = 1
) => convertUnitCostCents({ billedCents, unitsPer, from, to, vatPercent });

it("adds TVA to an HT cost: 8.50 DH HT at 20% is 10.20 DH TTC", () => {
  expect(convert(850, "ht", "ttc", 20)).toBe(1020);
});

it("removes TVA from a TTC cost: 10.20 DH TTC at 20% is 8.50 DH HT", () => {
  expect(convert(1020, "ttc", "ht", 20)).toBe(850);
});

it.each([
  [7, 10700],
  [10, 11000],
  [14, 11400],
  [20, 12000],
  [0, 10000],
])("converts 100.00 DH HT at %s%% TVA to %s centimes TTC", (rate, expected) => {
  expect(convert(10000, "ht", "ttc", rate)).toBe(expected);
});

it("leaves the cost alone when the printed and stored basis are the same, even without a rate", () => {
  expect(convert(850, "ht", "ht", null)).toBe(850);
  expect(convert(1020, "ttc", "ttc", null)).toBe(1020);
});

it("refuses to convert without a usable rate", () => {
  expect(convert(850, "ht", "ttc", null)).toBeNull();
  expect(convert(850, "ttc", "ht", 20.5)).toBeNull();
  expect(convert(850, "ht", "ttc", 101)).toBeNull();
  expect(convert(850, "ht", "ttc", -1)).toBeNull();
});

it("rounds half up, never down", () => {
  expect(convert(5, "ht", "ttc", 10)).toBe(6); // 5.5
  expect(convert(1, "ht", "ttc", 10)).toBe(1); // 1.1
  expect(convert(10000, "ttc", "ht", 20)).toBe(8333); // 8333.33
  expect(convert(1, "ttc", "ht", 20)).toBe(1); // 0.833
  expect(convert(100, "ttc", "ht", 100)).toBe(50); // exactly half of TTC
});

it("converts a carton price and divides it in one rounding step", () => {
  // 102.00 DH HT per carton of 12 -> 10.20 DH TTC per piece
  expect(convert(10200, "ht", "ttc", 20, 12)).toBe(1020);
  // 100.00 DH HT per carton of 12 -> 10.00 DH TTC per piece exactly; two roundings
  // (12000 / 12) would agree here, a less even case shows the difference:
  expect(convert(10001, "ht", "ttc", 20, 7)).toBe(1714); // 10001*1.2/7 = 1714.45
  expect(convert(10000, "ttc", "ht", 20, 12)).toBe(694); // 10000/1.2/12 = 694.44
});

it("converts no price into a negative one or one from impossible inputs", () => {
  expect(convert(-1, "ht", "ttc", 20)).toBeNull();
  expect(convert(850.5, "ht", "ttc", 20)).toBeNull();
  expect(convert(850, "ht", "ttc", 20, 0)).toBeNull();
  expect(convert(850, "ht", "ttc", 20, 10001)).toBeNull();
  expect(convert(0, "ht", "ttc", 20)).toBe(0);
});

describe("line discounts", () => {
  const base = { unitsPer: 1, from: "ht", to: "ht", vatPercent: null } as const;

  it("takes a percentage off the printed price", () => {
    expect(
      convertUnitCostCents({
        ...base,
        billedCents: 1000,
        discount: { kind: "percent", hundredths: 1000 },
      })
    ).toBe(900);
    expect(
      convertUnitCostCents({
        ...base,
        billedCents: 1000,
        discount: { kind: "percent", hundredths: 750 },
      })
    ).toBe(925);
  });

  it("takes an amount off the whole line, spread over its quantity", () => {
    // 10 x 10.00 DH less 5.00 DH = 9.50 DH each
    expect(
      convertUnitCostCents({
        ...base,
        billedCents: 1000,
        discount: { kind: "amount", cents: 500, quantityMilli: 10000 },
      })
    ).toBe(950);
  });

  it("discounts before TVA and pack division, rounding once", () => {
    // carton of 12 at 102.00 HT, 10% off, to TTC at 20%: 102*.9*1.2/12 = 9.18
    expect(
      convertUnitCostCents({
        billedCents: 10200,
        unitsPer: 12,
        from: "ht",
        to: "ttc",
        vatPercent: 20,
        discount: { kind: "percent", hundredths: 1000 },
      })
    ).toBe(918);
  });

  it("a full discount is a free item; no discount changes nothing", () => {
    expect(
      convertUnitCostCents({
        ...base,
        billedCents: 1000,
        discount: { kind: "percent", hundredths: 10000 },
      })
    ).toBe(0);
    expect(convertUnitCostCents({ ...base, billedCents: 1000, discount: null })).toBe(1000);
  });

  it.each([
    [{ kind: "percent", hundredths: 10001 }],
    [{ kind: "percent", hundredths: -1 }],
    [{ kind: "amount", cents: 20000, quantityMilli: 10000 }],
    [{ kind: "amount", cents: 100, quantityMilli: 0 }],
  ] as const)("refuses the impossible discount %j", (discount) => {
    expect(convertUnitCostCents({ ...base, billedCents: 1000, discount })).toBeNull();
  });
});

describe("discount on the whole invoice", () => {
  const base = { unitsPer: 1, from: "ht", to: "ht", vatPercent: null } as const;

  it("takes a percentage off every line cost", () => {
    expect(
      convertUnitCostCents({
        ...base,
        billedCents: 1000,
        globalDiscount: { kind: "percent", hundredths: 500 },
      })
    ).toBe(950);
  });

  it("spreads an amount over the lines in proportion to their sum", () => {
    // lines add up to 200.00, 20.00 off: every cost is 10% lower
    expect(
      convertUnitCostCents({
        ...base,
        billedCents: 1000,
        globalDiscount: { kind: "amount", cents: 2000, linesTotalCents: 20000 },
      })
    ).toBe(900);
  });

  it("comes after the line discount and before TVA, rounding once", () => {
    // 100.00 less 10% line = 90.00, less 5% invoice = 85.50, +20% TVA = 102.60
    expect(
      convertUnitCostCents({
        billedCents: 10000,
        unitsPer: 1,
        from: "ht",
        to: "ttc",
        vatPercent: 20,
        discount: { kind: "percent", hundredths: 1000 },
        globalDiscount: { kind: "percent", hundredths: 500 },
      })
    ).toBe(10260);
  });

  it.each([
    [{ kind: "percent", hundredths: 10001 }],
    [{ kind: "amount", cents: 30000, linesTotalCents: 20000 }],
    [{ kind: "amount", cents: 100, linesTotalCents: 0 }],
  ] as const)("refuses the impossible invoice discount %j", (globalDiscount) => {
    expect(convertUnitCostCents({ ...base, billedCents: 1000, globalDiscount })).toBeNull();
  });
});
