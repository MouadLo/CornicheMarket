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
