import {
  countUsage,
  newCategoryId,
  newSubCode,
  shownIcon,
  validateIconChoice,
  validateNames,
} from "../../src/lib/webstore/categories";
import { moveSorts } from "../../src/lib/webstore/order";

const ID = /^[a-z][a-z0-9]{1,19}$/;

describe("newCategoryId", () => {
  it("lowercase ASCII letters and digits, accents removed", () => {
    expect(newCategoryId("Épicerie & Co", [])).toBe("epicerieco");
    expect(newCategoryId("Boissons 33", [])).toBe("boissons33");
  });

  it("starts with a letter and is 2 to 20 characters", () => {
    expect(newCategoryId("123 Pâtes", [])).toBe("pates");
    expect(newCategoryId("a".repeat(50), [])).toHaveLength(20);
    expect(newCategoryId("X", [])).toMatch(ID);
    expect(newCategoryId("طعام", [])).toBe("cat");
    expect(newCategoryId("2026", [])).toBe("cat");
    expect(newCategoryId("", [])).toMatch(ID);
  });

  it("is unique by a number suffix that still fits in 20", () => {
    expect(newCategoryId("Drinks", ["drinks"])).toBe("drinks2");
    expect(newCategoryId("Drinks", ["drinks", "drinks2"])).toBe("drinks3");
    const long = "a".repeat(20);
    const next = newCategoryId("a".repeat(30), [long]);
    expect(next).toBe(`${"a".repeat(19)}2`);
    expect(next).toMatch(ID);
    expect(newCategoryId("طعام", ["cat"])).toBe("cat2");
    const many = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? long : `${"a".repeat(19 - (i >= 9 ? 1 : 0))}${i + 1}`
    );
    expect(newCategoryId("a".repeat(30), many)).toMatch(ID);
  });
});

describe("newSubCode", () => {
  it("is the trimmed English name, at most 40", () => {
    expect(newSubCode("  Soda  ", [])).toBe("Soda");
    expect(newSubCode("x".repeat(60), [])).toHaveLength(40);
  });

  it("is unique within the category only", () => {
    expect(newSubCode("Soda", ["Soda"])).toBe("Soda 2");
    expect(newSubCode("Soda", ["Soda", "Soda 2"])).toBe("Soda 3");
    expect(newSubCode("Soda", ["Juice"])).toBe("Soda");
    const long = "x".repeat(40);
    const next = newSubCode(long, [long]);
    expect(next.length).toBeLessThanOrEqual(40);
    expect(next.endsWith(" 2")).toBe(true);
  });

  it("never returns an empty code", () => {
    expect(newSubCode("   ", [])).toBe("sub");
  });
});

describe("validateNames / icon", () => {
  it("requires both names, at most 120", () => {
    expect(validateNames({ name: "", nameFr: "x" }).errors.name).toBe(
      "webstore.cats.errNameRequired"
    );
    expect(validateNames({ name: "x", nameFr: " " }).errors.nameFr).toBe(
      "webstore.cats.errNameRequired"
    );
    expect(validateNames({ name: "x".repeat(121), nameFr: "x" }).errors.name).toBe(
      "webstore.cats.errNameTooLong"
    );
    expect(validateNames({ name: " A ", nameFr: " B " }).names).toEqual({
      name: "A",
      name_fr: "B",
    });
  });

  it("knows the fifteen icons; an unknown stored icon shows as bag", () => {
    for (const i of [
      "drinks",
      "snacks",
      "phone",
      "home",
      "bag",
      "cup",
      "gift",
      "bread",
      "fresh",
      "dairy",
      "frozen",
      "clean",
      "care",
      "baby",
      "pet",
    ]) {
      expect(validateIconChoice(i)).toBeNull();
    }
    expect(validateIconChoice("rocket")).not.toBeNull();
    expect(shownIcon("rocket")).toBe("bag");
    expect(shownIcon("gift")).toBe("gift");
  });
});

describe("countUsage", () => {
  it("counts per category and per sub of a category", () => {
    const u = countUsage([
      { category_id: "drinks", sub_code: "Soda" },
      { category_id: "drinks", sub_code: "Soda" },
      { category_id: "drinks", sub_code: null },
      { category_id: "snacks", sub_code: "Soda" },
    ]);
    expect(u.byCategory).toEqual({ drinks: 3, snacks: 1 });
    expect(u.bySub).toEqual({ "drinks/Soda": 2, "snacks/Soda": 1 });
  });
});

describe("moveSorts", () => {
  const rows = (...sorts: number[]) => sorts.map((sort, i) => ({ key: `r${i}`, sort }));

  it("swaps the two sort values when they differ", () => {
    expect(moveSorts(rows(0, 1, 2), "r1", -1)).toEqual([
      { key: "r1", sort: 0 },
      { key: "r0", sort: 1 },
    ]);
    expect(moveSorts(rows(10, 20, 35), "r1", 1)).toEqual([
      { key: "r1", sort: 35 },
      { key: "r2", sort: 20 },
    ]);
  });

  it("renumbers by 10 when the neighbours have the same sort", () => {
    const updates = moveSorts(rows(0, 0, 0), "r2", -1);
    // new order: r0, r2, r1 -> 0, 10, 20; r0 is already 0
    expect(updates).toEqual([
      { key: "r2", sort: 10 },
      { key: "r1", sort: 20 },
    ]);
  });

  it("does nothing at the ends or for an unknown key", () => {
    expect(moveSorts(rows(0, 1), "r0", -1)).toEqual([]);
    expect(moveSorts(rows(0, 1), "r1", 1)).toEqual([]);
    expect(moveSorts(rows(0, 1), "nope", 1)).toEqual([]);
  });
});
