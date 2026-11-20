import {
  clampIndex,
  clearPlace,
  DEFAULT_PLACE_FILTERS,
  filtersKeyOf,
  peekPlace,
  placeApplies,
  rememberPlace,
  takePlace,
} from "../../src/lib/products/listPlace";

const base = { productId: "p-1", index: 12, loadedPages: 2, filters: DEFAULT_PLACE_FILTERS };

beforeEach(clearPlace);

it("remembers a place, peeks without clearing, and takePlace clears it", () => {
  expect(takePlace()).toBeNull();
  rememberPlace(base);
  expect(peekPlace()?.productId).toBe("p-1");
  expect(peekPlace()).not.toBeNull();
  expect(takePlace()).toMatchObject({ productId: "p-1", index: 12, loadedPages: 2 });
  expect(takePlace()).toBeNull();
});

it("a new place replaces the previous one", () => {
  rememberPlace(base);
  rememberPlace({ ...base, productId: "p-2" });
  expect(takePlace()?.productId).toBe("p-2");
});

it("filtersKeyOf is stable and sensitive to every filter", () => {
  const k = filtersKeyOf(DEFAULT_PLACE_FILTERS);
  expect(filtersKeyOf({ ...DEFAULT_PLACE_FILTERS })).toBe(k);
  expect(filtersKeyOf({ ...DEFAULT_PLACE_FILTERS, search: " " })).toBe(k);
  for (const change of [
    { search: "lait" },
    { categoryId: "c" },
    { subCategoryId: "s" },
    { lowStockOnly: true },
    { status: "all" as const },
  ]) {
    expect(filtersKeyOf({ ...DEFAULT_PLACE_FILTERS, ...change })).not.toBe(k);
  }
});

it("a place applies only to the filters it was taken with", () => {
  rememberPlace({ ...base, filters: { ...DEFAULT_PLACE_FILTERS, search: "lait" } });
  const place = peekPlace();
  expect(placeApplies(place, filtersKeyOf({ ...DEFAULT_PLACE_FILTERS, search: "lait" }))).toBe(
    true
  );
  expect(placeApplies(place, filtersKeyOf(DEFAULT_PLACE_FILTERS))).toBe(false);
  expect(placeApplies(null, filtersKeyOf(DEFAULT_PLACE_FILTERS))).toBe(false);
});

it("clampIndex keeps the landing row inside the list", () => {
  expect(clampIndex(5, 10)).toBe(5);
  expect(clampIndex(50, 10)).toBe(9);
  expect(clampIndex(-3, 10)).toBe(0);
  expect(clampIndex(4, 0)).toBe(0);
});
