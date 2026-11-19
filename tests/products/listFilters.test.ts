import {
  activeFilterCount,
  COMPACT_PRODUCTS_WIDTH,
  isCompactProductsList,
} from "../../src/lib/products/listFilters";

describe("isCompactProductsList", () => {
  it("is compact on phones and full from tablet width", () => {
    expect(isCompactProductsList(390)).toBe(true);
    expect(isCompactProductsList(COMPACT_PRODUCTS_WIDTH - 1)).toBe(true);
    expect(isCompactProductsList(COMPACT_PRODUCTS_WIDTH)).toBe(false);
  });
});

describe("activeFilterCount", () => {
  const none = { categoryId: null, lowStockOnly: false, status: "active" as const };

  it("does not count the default view", () => {
    expect(activeFilterCount(none)).toBe(0);
  });

  it("counts a category, low stock and a non-default status", () => {
    expect(activeFilterCount({ ...none, categoryId: "c1" })).toBe(1);
    expect(activeFilterCount({ ...none, lowStockOnly: true })).toBe(1);
    expect(activeFilterCount({ ...none, status: "inactive" })).toBe(1);
    expect(activeFilterCount({ categoryId: "c1", lowStockOnly: true, status: "all" })).toBe(3);
  });
});
