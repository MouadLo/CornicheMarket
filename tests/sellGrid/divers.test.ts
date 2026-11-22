import {
  effectiveExcludedCategoryIds,
  earnLinesOf,
  eligibleCentsOf,
} from "../../src/lib/loyalty/basket";
import { restoreLine, restoreLines } from "../../src/lib/sales/restoreLines";
import { cashierDiscountProblem } from "../../src/lib/sales/discountLimit";
import {
  cartLineFrom,
  cartSubtotal,
  hasInvalidQuantity,
  lineKey,
  type CartLine,
} from "../../src/lib/sales/totals";
import { receiptFromPendingSale } from "../../src/lib/sales/receipt";
import {
  DIVERS_NOTE_MAX,
  addDiversLine,
  cleanDiversNote,
  diversAmountProblem,
  diversCartLine,
  diversLimitFor,
  entryToCents,
  parseDiversConfig,
  pressAmountKey,
} from "../../src/lib/sellGrid/divers";
import type { WeightKey } from "../../src/lib/sales/weightEntry";

const CONFIG = { productId: "divers-id", maxCents: 20000 };
const type = (keys: string): string =>
  [...keys].reduce(
    (entry, key) => pressAmountKey(entry, (key === "<" ? "back" : key) as WeightKey),
    ""
  );

describe("amount entry", () => {
  it("builds an amount with one decimal point and two decimals", () => {
    expect(type("12.5")).toBe("12.5");
    expect(type("12.567")).toBe("12.56");
    expect(type("1..2")).toBe("1.2");
    expect(type(".5")).toBe("0.5");
    expect(type("007")).toBe("7");
    expect(type("12<")).toBe("1");
  });

  it("stops at six integer digits", () => {
    expect(type("12345678")).toBe("123456");
  });

  it("is chargeable only above zero", () => {
    expect(entryToCents("")).toBeNull();
    expect(entryToCents("0")).toBeNull();
    expect(entryToCents("0.")).toBeNull();
    expect(entryToCents("12.5")).toBe(1250);
    expect(entryToCents("12,5")).toBe(1250);
    expect(entryToCents("200")).toBe(20000);
  });
});

describe("the limit", () => {
  it("a cashier is held to the maximum, the owner has none", () => {
    expect(diversLimitFor(false, 20000)).toBe(20000);
    expect(diversLimitFor(true, 20000)).toBeNull();
  });

  it("empty and zero are never allowed", () => {
    expect(diversAmountProblem(null, 20000)).toBe("empty");
    expect(diversAmountProblem(0, null)).toBe("empty");
  });

  it("a cashier may add exactly the maximum, not a centime more", () => {
    expect(diversAmountProblem(20000, 20000)).toBeNull();
    expect(diversAmountProblem(20001, 20000)).toBe("over");
  });

  it("the owner may add any amount above zero", () => {
    expect(diversAmountProblem(50000, null)).toBeNull();
    expect(diversAmountProblem(99_999_999, null)).toBeNull();
  });
});

describe("the note", () => {
  it("is trimmed, empty means none, and stops at 60 characters", () => {
    expect(cleanDiversNote("  sac  ")).toBe("sac");
    expect(cleanDiversNote("   ")).toBeNull();
    expect(cleanDiversNote("")).toBeNull();
    expect(cleanDiversNote("x".repeat(80))).toHaveLength(DIVERS_NOTE_MAX);
    expect(DIVERS_NOTE_MAX).toBe(60);
  });
});

describe("the config", () => {
  it("reads a stored value and refuses anything unusable", () => {
    expect(parseDiversConfig(CONFIG)).toEqual(CONFIG);
    expect(parseDiversConfig(null)).toBeNull();
    expect(parseDiversConfig(undefined)).toBeNull();
    expect(parseDiversConfig({ productId: "", maxCents: 100 })).toBeNull();
    expect(parseDiversConfig({ productId: "x", maxCents: 0 })).toBeNull();
    expect(parseDiversConfig({ productId: "x", maxCents: 1.5 })).toBeNull();
    expect(parseDiversConfig({ maxCents: 100 })).toBeNull();
  });
});

describe("a Divers cart line", () => {
  const line = (amountCents: number, note: string | null, key: string) =>
    diversCartLine(CONFIG, { amountCents, note, name: "Divers", key });

  it("is quantity 1 at the typed amount, with no cost and loyalty.misc set", () => {
    const l = line(1250, "sac", "k1");
    expect(l).toMatchObject({
      product_id: "divers-id",
      name: "Divers",
      quantity: 1,
      unit_price_cents: 1250,
      discount_cents: 0,
      unit_cost_cents: null,
      note: "sac",
      key: "k1",
      loyalty: { misc: true },
    });
  });

  it("has no note field when there is none", () => {
    expect(line(500, null, "k")).not.toHaveProperty("note");
  });

  it("two Divers lines stay separate, each with its own note, and never merge", () => {
    let lines: CartLine[] = [];
    lines = addDiversLine(lines, line(500, "sac", "k1"));
    lines = addDiversLine(lines, line(500, "sac", "k2"));
    lines = addDiversLine(lines, line(700, "recharge", "k3"));
    expect(lines).toHaveLength(3);
    expect(lines.map(lineKey)).toEqual(["k1", "k2", "k3"]);
    expect(lines.map((l) => l.note)).toEqual(["sac", "sac", "recharge"]);
    expect(cartSubtotal(lines)).toBe(1700);
    expect(hasInvalidQuantity(lines)).toBe(false);
  });

  it("a regular product line is still identified by its product", () => {
    const milk = cartLineFrom(
      { id: "p1", name: "Milk", unit: "piece", selling_price_cents: 700 },
      1
    );
    expect(lineKey(milk)).toBe("p1");
    expect(milk).not.toHaveProperty("key");
  });

  it("undo puts back the removed Divers line only, never a duplicate of another", () => {
    const a = line(500, "a", "k1");
    const b = line(500, "b", "k2");
    expect(restoreLine([b], a, 0).map(lineKey)).toEqual(["k1", "k2"]);
    expect(restoreLine([a, b], a, 0)).toHaveLength(2);
    expect(restoreLines([b], [a, b]).map(lineKey)).toEqual(["k1", "k2"]);
  });

  it("never earns or spends loyalty points", () => {
    const l = line(10000, null, "k");
    const earn = earnLinesOf([l], new Set(), Date.now());
    expect(earn[0]).toMatchObject({ totalCents: 10000, eligible: false, bonusPerUnit: 0 });
    expect(eligibleCentsOf([l], new Set(), 0)).toBe(0);
    expect(effectiveExcludedCategoryIds([])).toEqual([]);
  });

  it("the cashier discount limit names the Divers line by its own key", () => {
    const discounted = { ...line(1000, null, "k9"), discountable: false, discount_cents: 100 };
    expect(cashierDiscountProblem([discounted], 0, { percent: 5, maxCents: 2000 })).toEqual({
      kind: "blocked",
      lineIds: ["k9"],
    });
  });

  it("prints on the receipt as Divers and its note", () => {
    const sale = {
      id: "s1",
      customer_id: null,
      payment_method: "cash" as const,
      discount_cents: 0,
      total_cents: 1500,
      attempts: 0,
      created_at: "2026-11-22T10:00:00.000Z",
      lines: [line(1000, "sac", "k1"), line(500, null, "k2")],
    };
    const receipt = receiptFromPendingSale(sale);
    expect(receipt.lines.map((l) => l.name)).toEqual(["Divers - sac", "Divers"]);
    expect(receipt.lines.map((l) => l.totalCents)).toEqual([1000, 500]);
  });
});
