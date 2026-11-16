import {
  cleanCategoryName,
  decideCategory,
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
