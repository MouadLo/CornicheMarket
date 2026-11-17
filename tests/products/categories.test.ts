import {
  cleanCategoryName,
  decideCategory,
  familyIds,
  inTreeOrder,
  mainCategories,
  mainCategoryId,
  subCategoriesOf,
  findSameCategory,
  MAX_CATEGORY_NAME,
  withCategory,
} from "@/src/lib/products/categories";

const existing = [
  { id: "1", name: "Boissons" },
  { id: "2", name: "Épicerie" },
  { id: "3", name: "Produits laitiers" },
];

describe("cleanCategoryName", () => {
  it("trims and collapses spaces", () => {
    expect(cleanCategoryName("  Produits   ménagers  ")).toBe("Produits ménagers");
    expect(cleanCategoryName("   ")).toBe("");
  });
});

describe("findSameCategory", () => {
  it.each(["boissons", "BOISSONS", " Boissons ", "epicerie", "ÉPICERIE", "produits  laitiers"])(
    "finds %j as an existing category",
    (name) => {
      expect(findSameCategory(name, existing)).not.toBeNull();
    }
  );

  it("does not confuse different names", () => {
    expect(findSameCategory("Boisson", existing)).toBeNull();
    expect(findSameCategory("Snacks", existing)).toBeNull();
  });
});

describe("decideCategory", () => {
  it("creates a new name, tidied", () => {
    expect(decideCategory("  Produits   ménagers ", existing)).toEqual({
      kind: "create",
      name: "Produits ménagers",
    });
  });

  it("uses the existing category instead of creating a twin", () => {
    expect(decideCategory("epicerie", existing)).toEqual({
      kind: "existing",
      category: { id: "2", name: "Épicerie" },
    });
  });

  it("refuses an empty name and one that is too long", () => {
    expect(decideCategory("   ", existing)).toEqual({ kind: "invalid" });
    expect(decideCategory("x".repeat(MAX_CATEGORY_NAME + 1), existing)).toEqual({
      kind: "invalid",
    });
    expect(decideCategory("x".repeat(MAX_CATEGORY_NAME), existing).kind).toBe("create");
  });
});

describe("withCategory", () => {
  it("adds in name order and never twice", () => {
    const next = withCategory(existing, { id: "9", name: "Hygiène" });
    expect(next.map((category) => category.name)).toEqual([
      "Boissons",
      "Épicerie",
      "Hygiène",
      "Produits laitiers",
    ]);
    expect(withCategory(next, { id: "9", name: "Hygiène" })).toHaveLength(4);
  });
});

describe("sub-category helpers", () => {
  const all = [
    { id: "bev", name: "Boissons", parent_id: null },
    { id: "water", name: "Eaux", parent_id: "bev" },
    { id: "juice", name: "Jus", parent_id: "bev" },
    { id: "bread", name: "Pain", parent_id: null },
  ];

  it("splits main categories from sub-categories", () => {
    expect(mainCategories(all).map((c) => c.id)).toEqual(["bev", "bread"]);
    expect(subCategoriesOf(all, "bev").map((c) => c.id)).toEqual(["water", "juice"]);
    expect(subCategoriesOf(all, "bread")).toEqual([]);
  });

  it("covers a main category and its subs in a filter", () => {
    expect(familyIds(all, "bev")).toEqual(["bev", "water", "juice"]);
    expect(familyIds(all, "water")).toEqual(["water"]);
  });

  it("finds the main category of any category", () => {
    expect(mainCategoryId(all, "water")).toBe("bev");
    expect(mainCategoryId(all, "bev")).toBe("bev");
    expect(mainCategoryId(all, null)).toBeNull();
  });
});

describe("inTreeOrder", () => {
  it("puts each sub-category right after its parent", () => {
    const all = [
      { id: "bev", name: "Boissons", parent_id: null },
      { id: "bread", name: "Pain", parent_id: null },
      { id: "water", name: "Eaux", parent_id: "bev" },
    ];
    expect(inTreeOrder(all).map((c) => c.id)).toEqual(["bev", "water", "bread"]);
  });
});
