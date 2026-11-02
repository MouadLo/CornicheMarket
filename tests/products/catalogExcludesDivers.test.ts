/**
 * The built-in Divers item (kind 'misc') is a sale item, not a catalogue
 * product: it must not appear in the Products list, the empty-store check or
 * the offline cache, or the owner would see a phantom product at 0 DH and a
 * brand-new store would never get its first-run prompt.
 */
import { fetchProducts, hasAnyProducts } from "../../src/lib/products/queries";
import { refreshProductCache } from "../../src/lib/products/offlineCache";

const mockFilters: string[] = [];
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "range", "limit", "or"]) b[m] = () => b;
      b.eq = (column: string, value: unknown) => {
        mockFilters.push(`${table}:${column}=${String(value)}`);
        return b;
      };
      b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return b;
    },
  },
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

beforeEach(() => (mockFilters.length = 0));

describe("Divers stays out of the catalogue", () => {
  it("the Products list asks for regular products only, for owners and cashiers", async () => {
    await fetchProducts(
      { search: "", categoryId: null, lowStockOnly: false, status: "all" },
      0,
      true
    );
    await fetchProducts(
      { search: "", categoryId: null, lowStockOnly: false, status: "all" },
      0,
      false
    );
    expect(mockFilters).toContain("products:kind=regular");
    expect(mockFilters).toContain("products_cashier_view:kind=regular");
  });

  it("the empty-store check ignores it", async () => {
    await hasAnyProducts();
    expect(mockFilters).toContain("products:kind=regular");
  });

  it("the offline cache does not store it", async () => {
    await refreshProductCache(false);
    expect(mockFilters).toContain("products_cashier_view:kind=regular");
  });
});
