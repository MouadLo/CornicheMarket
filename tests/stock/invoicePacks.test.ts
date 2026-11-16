import {
  buildReviewedInvoiceLine,
  reviewLineIssues,
  canHavePackSize,
  initialReviewLine,
  showsPackSize,
  withProduct,
  withRememberedMatch,
  withUnitsPer,
  type CostBasis,
  type InvoiceSourceLine,
} from "@/src/lib/stock/invoices";

jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));

// Packs with no printed billing unit: the count is in the name, or only the owner knows it.
const line = (description: string, quantity: string, price: string): InvoiceSourceLine => ({
  description,
  billed: "",
  billing_unit: null,
  billed_quantity: quantity,
  billed_unit_cost: price,
  vat_percent: 20,
  discount_text: null,
  quantity,
  unit: "piece",
  unit_cost: price,
});
const ht: CostBasis = { printed: "ht", store: "ht", global: null };
const coca = line("COCA-COLA PET 45*12", "8", "50.50");
const water = line("SIDI ALI PET 33CL", "11", "20.40");
const existing = (unit: "piece" | "pack") => ({
  kind: "existing" as const,
  id: "p",
  name: "P",
  unit,
});

it("starts a line whose name says 45*12 as 8 packs of 12, flagged for the owner to check", () => {
  const start = initialReviewLine(coca, ht);
  expect(start).toMatchObject({
    unitsPer: "12",
    quantity: "96",
    unitCost: "4.21", // 50.50 / 12 = 4.208…
    packOpen: true,
    unitsFromName: true,
  });
  expect(showsPackSize(coca, start)).toBe(true);
});

it("leaves a name without a count as single pieces, with the field closed but available", () => {
  const start = initialReviewLine(water, ht);
  expect(start).toMatchObject({ unitsPer: "", quantity: "11", unitCost: "20.40" });
  expect(showsPackSize(water, start)).toBe(false);
  expect(canHavePackSize(water, start)).toBe(true);
});

it("converts once the owner types the pieces per pack, and back when they empty it", () => {
  const start = { ...initialReviewLine(water, ht), product: existing("piece") };
  const pack = withUnitsPer(water, start, "6", ht);
  expect(pack).toMatchObject({ quantity: "66", unitCost: "3.40", unitsFromName: false });
  expect(buildReviewedInvoiceLine(pack)?.units_per_billing_unit).toBe(6);
  const single = withUnitsPer(water, pack, "", ht);
  expect(single).toMatchObject({ quantity: "11", unitCost: "20.40" });
  expect(buildReviewedInvoiceLine(single)?.units_per_billing_unit).toBeNull();
});

it("refuses an invalid pieces-per-pack value rather than guessing", () => {
  const start = { ...initialReviewLine(water, ht), product: existing("piece") };
  expect(buildReviewedInvoiceLine(withUnitsPer(water, start, "1.5", ht))).toBeNull();
});

it("receives the billed pack as is for a product stocked by the pack", () => {
  const chosen = withProduct(coca, initialReviewLine(coca, ht), existing("pack"), ht);
  expect(chosen).toMatchObject({ unitsPer: "", quantity: "8", unitCost: "50.50" });
  expect(canHavePackSize(coca, chosen)).toBe(false);
  expect(showsPackSize(coca, chosen)).toBe(false);
});

it("keeps the pack of 12 when the owner picks a product stocked by the piece", () => {
  const chosen = withProduct(coca, initialReviewLine(coca, ht), existing("piece"), ht);
  expect(chosen).toMatchObject({ unitsPer: "12", quantity: "96" });
});

describe("the owner's earlier answer for this supplier and wording", () => {
  const match = (units: number | null) => ({
    line_index: 0,
    product_id: "p",
    product_name: "P",
    product_unit: "piece" as const,
    units_per_billing_unit: units,
    exact: true,
    score: 1,
  });

  it("wins over the name: last time this line was single pieces", () => {
    const next = withRememberedMatch(coca, initialReviewLine(coca, ht), match(1), ht);
    expect(next).toMatchObject({
      unitsPer: "",
      quantity: "8",
      packOpen: false,
      unitsFromName: false,
    });
  });

  it("opens the field with the remembered count on a name that does not say it", () => {
    const next = withRememberedMatch(water, initialReviewLine(water, ht), match(6), ht);
    expect(next).toMatchObject({ unitsPer: "6", quantity: "66", unitCost: "3.40", packOpen: true });
  });
});

it("guesses nothing on an older draft without printed prices", () => {
  const old = { ...coca, billed_unit_cost: undefined, billed_quantity: undefined };
  expect(initialReviewLine(old)).toMatchObject({ unitsPer: "", quantity: "8" });
});

describe("what is left to do on a line", () => {
  // As the parser leaves a printed carton line: quantity and cost wait for the count.
  const carton: InvoiceSourceLine = {
    ...water,
    description: "Eau",
    billing_unit: "carton",
    quantity: "",
    unit_cost: "",
  };

  it("names each missing piece", () => {
    const start = initialReviewLine(water, ht);
    expect(reviewLineIssues(water, start)).toEqual(["product"]);
    const fresh = withProduct(
      water,
      start,
      { kind: "new", name: " ", unit: "piece", sellingPrice: "" },
      ht
    );
    expect(reviewLineIssues(water, fresh)).toEqual(["productName", "sellingPrice"]);
    const chosen = { ...start, product: existing("piece") };
    expect(reviewLineIssues(water, chosen)).toEqual([]);
    expect(reviewLineIssues(water, { ...chosen, quantity: "" })).toEqual(["quantity"]);
    expect(reviewLineIssues(water, { ...chosen, quantity: "2.5" })).toEqual(["wholeQuantity"]);
    expect(reviewLineIssues(water, { ...chosen, unitCost: "abc" })).toEqual(["cost"]);
    expect(reviewLineIssues(water, withUnitsPer(water, chosen, "1.5", ht))).toEqual(["unitsPer"]);
  });

  it("asks for the pieces per carton, not quantity and cost, on a carton line without its count", () => {
    const start = { ...initialReviewLine(carton, ht), product: existing("piece") };
    expect(start.quantity).toBe("");
    expect(reviewLineIssues(carton, start)).toEqual(["unitsPer"]);
    expect(reviewLineIssues(carton, withUnitsPer(carton, start, "6", ht))).toEqual([]);
  });

  it("is empty exactly when approval accepts the line", () => {
    const products = [
      null,
      existing("piece"),
      existing("pack"),
      { kind: "new" as const, name: "N", unit: "piece" as const, sellingPrice: "5" },
    ];
    const values = ["", "3", "2.5", "abc"];
    for (const source of [water, carton])
      for (const product of products)
        for (const quantity of values)
          for (const unitCost of values)
            for (const unitsPer of ["", "6", "0"]) {
              const line = { product, quantity, unitCost, unitsPer };
              expect([
                source.description,
                product?.kind,
                quantity,
                unitCost,
                unitsPer,
                reviewLineIssues(source, line).length === 0,
              ]).toEqual([
                source.description,
                product?.kind,
                quantity,
                unitCost,
                unitsPer,
                buildReviewedInvoiceLine(line) !== null,
              ]);
            }
  });
});
