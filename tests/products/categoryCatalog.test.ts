import {
  CATEGORY_CATALOG,
  categoryLabel,
  existingFor,
  findCatalogEntry,
  localizeCategoryName,
  suggestionsFor,
} from "@/src/lib/products/categoryCatalog";

describe("the catalogue", () => {
  it("has unique, well-formed codes (they are permanent: reports rely on them)", () => {
    const codes = CATEGORY_CATALOG.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("names every entry in all three languages, and no two entries share a name", () => {
    for (const entry of CATEGORY_CATALOG)
      for (const lang of ["fr", "en", "ar"] as const) expect(entry[lang].trim()).not.toBe("");
    for (const lang of ["fr", "en", "ar"] as const) {
      const names = CATEGORY_CATALOG.map((entry) => entry[lang]);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("keeps names short enough for a tile tab, and the optional ones last", () => {
    for (const entry of CATEGORY_CATALOG) expect(entry.fr.length).toBeLessThanOrEqual(40);
    const firstOptional = CATEGORY_CATALOG.findIndex((entry) => entry.optional);
    expect(CATEGORY_CATALOG.slice(firstOptional).every((entry) => entry.optional)).toBe(true);
  });

  it("looks entries up by code", () => {
    expect(findCatalogEntry("beverages")?.fr).toBe("Boissons");
    expect(findCatalogEntry("nope")).toBeNull();
    expect(findCatalogEntry(null)).toBeNull();
  });
});

describe("categoryLabel", () => {
  it("shows a coded category in the language in use", () => {
    const category = { name: "Boissons", code: "beverages" };
    expect(categoryLabel(category, "fr")).toBe("Boissons");
    expect(categoryLabel(category, "en")).toBe("Beverages");
    expect(categoryLabel(category, "ar")).toBe("المشروبات");
  });

  it("translates an older category whose name the catalogue knows", () => {
    expect(categoryLabel({ name: "boissons" }, "en")).toBe("Beverages");
    expect(categoryLabel({ name: "Epicerie salée" }, "en")).toBe("Savory pantry");
  });

  it("leaves a category the owner typed exactly as typed", () => {
    expect(categoryLabel({ name: "Phone accessories" }, "fr")).toBe("Phone accessories");
    expect(categoryLabel({ name: "Drink", code: null }, "ar")).toBe("Drink");
  });

  it("falls back to French for an unknown language", () => {
    expect(categoryLabel({ name: "x", code: "bakery" }, undefined)).toBe(
      "Boulangerie et pâtisserie"
    );
    expect(categoryLabel({ name: "x", code: "bakery" }, "es")).toBe("Boulangerie et pâtisserie");
  });
});

describe("localizeCategoryName", () => {
  it("translates a known name in any language, and keeps unknown ones", () => {
    expect(localizeCategoryName("Fruits et légumes", "en")).toBe("Fruit & vegetables");
    expect(localizeCategoryName("Baby", "fr")).toBe("Bébé");
    expect(localizeCategoryName("Quincaillerie", "en")).toBe("Quincaillerie");
  });
});

describe("existingFor and suggestionsFor", () => {
  const existing = [
    { id: "1", name: "Boissons", code: "beverages" },
    { id: "2", name: "Snacks et confiserie" }, // typed by hand before the catalogue
    { id: "3", name: "Drink" },
  ];

  it("recognises an entry by its code, or by an older category with its name", () => {
    expect(existingFor(findCatalogEntry("beverages")!, existing)?.id).toBe("1");
    expect(existingFor(findCatalogEntry("snacks_sweets")!, existing)?.id).toBe("2");
    expect(existingFor(findCatalogEntry("bakery")!, existing)).toBeNull();
  });

  it("does not take a category that already carries another code", () => {
    const taken = [{ id: "9", name: "Boissons", code: "other" }];
    expect(existingFor(findCatalogEntry("beverages")!, taken)).toBeNull();
  });

  it("offers only entries not already in use", () => {
    const codes = suggestionsFor(existing).map((entry) => entry.code);
    expect(codes).not.toContain("beverages");
    expect(codes).not.toContain("snacks_sweets");
    expect(codes).toContain("bakery");
    expect(suggestionsFor([])).toHaveLength(CATEGORY_CATALOG.length);
  });
});
