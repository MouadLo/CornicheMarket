import {
  convertPackLine,
  isWeightBillingUnit,
  parseUnitsPerBillingUnit,
  unitsFromBillingUnit,
} from "@/src/lib/stock/packs";

it("receives 1 carton of 12 at 102.00 DH as 12 pieces at 8.50 DH", () => {
  expect(convertPackLine(1, 10200, 12)).toEqual({ quantity: 12, unitCostCents: 850 });
});

it("multiplies several cartons", () => {
  expect(convertPackLine(2, 21600, 12)).toEqual({ quantity: 24, unitCostCents: 1800 });
});

it.each([
  [10000, 12, 833], // 8.333… -> 8.33
  [1000, 6, 167], // 1.666… -> 1.67
  [5, 2, 3], // 2.5 centimes rounds half up
  [7, 2, 4], // 3.5 -> 4
  [1, 3, 0], // 0.33 -> 0
  [0, 12, 0], // free carton
])("rounds %s centimes over %s units half up to %s", (cost, units, expected) => {
  expect(convertPackLine(1, cost, units)?.unitCostCents).toBe(expected);
});

it("keeps quantities exact to 3 decimals", () => {
  expect(convertPackLine(1.5, 1200, 12)?.quantity).toBe(18);
  expect(convertPackLine(0.125, 1000, 8)?.quantity).toBe(1);
  expect(convertPackLine(0.1, 1000, 3)?.quantity).toBe(0.3);
});

it("is a no-op for one unit per billed unit", () => {
  expect(convertPackLine(6, 850, 1)).toEqual({ quantity: 6, unitCostCents: 850 });
});

it.each([
  [1, 100, 0],
  [1, 100, 1.5],
  [1, 100, 10001],
  [0, 100, 12],
  [-1, 100, 12],
  [1, -1, 12],
  [1, 10.5, 12],
  [Number.NaN, 100, 12],
])("refuses quantity %s, cost %s, units %s", (quantity, cost, units) => {
  expect(convertPackLine(quantity, cost, units)).toBeNull();
});

it.each([
  ["12", 12],
  [" 6 ", 6],
  ["1", 1],
  ["10000", 10000],
  ["0", null],
  ["10001", null],
  ["1.5", null],
  ["12,0", null],
  ["", null],
  ["abc", null],
])("reads %j pieces per billed unit as %s", (text, units) => {
  expect(parseUnitsPerBillingUnit(text)).toBe(units);
});

it.each([
  ["kg", true],
  ["KG", true],
  ["kilo", true],
  ["Kilogrammes", true],
  ["كغ", true],
  ["carton de 12", false],
  ["pièce", false],
  [null, false],
])("recognizes %j as weight billing: %s", (unit, expected) => {
  expect(isWeightBillingUnit(unit)).toBe(expected);
});

it.each([
  ["carton de 12", 12],
  ["pack 6", 6],
  ["x24", 24],
  ["علبة ١٢", 12],
  ["Carton", null],
  ["carton 1", null],
  ["carton de 12 x 6", null],
  ["bouteille 1,5", null],
  ["carton 5000", null],
  [null, null],
])("reads the pack count printed in %j as %s", (unit, expected) => {
  expect(unitsFromBillingUnit(unit)).toBe(expected);
});
