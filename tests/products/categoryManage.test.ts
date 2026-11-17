import { findCatalogEntry } from "@/src/lib/products/categoryCatalog";
import {
  canDelete,
  canMergeOrMove,
  decideLink,
  decideRename,
  mergeTargets,
  moveTargets,
} from "@/src/lib/products/categoryManage";

const drink = { id: "1", name: "Drink", code: null };
const snacks = { id: "2", name: "Snacks", code: null };
const bakery = { id: "3", name: "Boulangerie et pâtisserie", code: "bakery" };
const all = [drink, snacks, bakery];
const beverages = findCatalogEntry("beverages")!;

describe("decideRename", () => {
  it("renames to the cleaned name", () => {
    expect(decideRename(drink, "  Jus   frais ", all)).toEqual({
      kind: "rename",
      name: "Jus frais",
    });
  });

  it("rejects empty and too long names", () => {
    expect(decideRename(drink, "   ", all)).toEqual({ kind: "invalid" });
    expect(decideRename(drink, "x".repeat(61), all)).toEqual({ kind: "invalid" });
  });

  it("does nothing when the name is the same", () => {
    expect(decideRename(drink, "Drink ", all)).toEqual({ kind: "unchanged" });
  });

  it("allows changing only the case of its own name", () => {
    expect(decideRename(drink, "DRINK", all)).toEqual({ kind: "rename", name: "DRINK" });
  });

  it("points to the other category when the name reads the same", () => {
    expect(decideRename(drink, "snacks", all)).toEqual({ kind: "clash", other: snacks });
  });

  it("refuses to rename a standard category", () => {
    expect(decideRename(bakery, "Pain", all)).toEqual({ kind: "standard" });
  });
});

describe("decideLink", () => {
  it("links a typed category to a standard one", () => {
    expect(decideLink(drink, beverages, all)).toEqual({
      kind: "link",
      name: "Boissons",
      code: "beverages",
    });
  });

  it("merges when the shop already has that standard category", () => {
    const boissons = { id: "4", name: "Boissons", code: "beverages" };
    expect(decideLink(drink, beverages, [...all, boissons])).toEqual({
      kind: "merge",
      target: boissons,
    });
  });

  it("merges into an older category typed with the standard name", () => {
    const typed = { id: "5", name: "beverages", code: null };
    expect(decideLink(drink, beverages, [...all, typed])).toEqual({ kind: "merge", target: typed });
  });

  it("links a category whose own name is the standard name", () => {
    const typed = { id: "5", name: "Boissons", code: null };
    expect(decideLink(typed, beverages, [...all, typed])).toEqual({
      kind: "link",
      name: "Boissons",
      code: "beverages",
    });
  });

  it("reports a category that is already linked", () => {
    expect(decideLink(bakery, findCatalogEntry("bakery")!, all)).toEqual({ kind: "already" });
  });
});

describe("mergeTargets and canDelete", () => {
  it("offers every other category", () => {
    expect(mergeTargets(drink, all)).toEqual([snacks, bakery]);
  });

  it("deletes only empty categories", () => {
    expect(canDelete({ ...drink, productCount: 0 }, all)).toBe(true);
    expect(canDelete({ ...drink, productCount: 3 }, all)).toBe(false);
  });
});

describe("sub-category rules", () => {
  const water = { id: "w", name: "Eaux", code: null, parent_id: "1" };
  const tree = [...all, water];

  it("keeps a parent until its sub-categories are gone", () => {
    expect(canDelete({ ...drink, productCount: 0 }, tree)).toBe(false);
    expect(canMergeOrMove(drink, tree)).toBe(false);
    expect(canMergeOrMove(water, tree)).toBe(true);
  });

  it("moves only under another main category", () => {
    expect(moveTargets(snacks, tree).map((c) => c.id)).toEqual(["1", "3"]);
    expect(moveTargets(water, tree).map((c) => c.id)).toEqual(["2", "3"]);
    expect(moveTargets(drink, tree)).toEqual([]);
  });
});
