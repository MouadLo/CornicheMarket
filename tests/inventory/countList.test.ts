import {
  CONFIRM_FULL_LIST_MAX,
  confirmPreview,
  countProgress,
  countedQuantity,
  hasUnsavedWork,
  isInvalidCount,
  isEligible,
  mergeProducts,
  runInBatches,
  visibleLines,
  type CountLine,
} from "../../src/lib/inventory/countList";
import { parseQuantity } from "../../src/lib/money";
import type { Product } from "../../src/lib/products/queries";

const product = (id: string, stock = 10): Product => ({
  id,
  name: id,
  barcode: null,
  category_id: null,
  unit: "piece",
  selling_price_cents: 100,
  stock_quantity: stock,
  low_stock_threshold: 0,
  is_low_stock: false,
  active: true,
  current_cost_cents: null,
});
const line = (id: string, counted = "", extra: Partial<CountLine> = {}): CountLine => ({
  product: product(id),
  counted,
  ...extra,
});

describe("an empty line is not zero", () => {
  it("parseQuantity reads empty and blank text as nothing", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("   ")).toBeNull();
    expect(parseQuantity(" \t ")).toBeNull();
    expect(parseQuantity("-")).toBeNull();
    expect(parseQuantity(".")).toBeNull();
  });

  it("an empty or blank line is not counted and never eligible", () => {
    expect(countedQuantity(line("a", ""))).toBeNull();
    expect(countedQuantity(line("a", "   "))).toBeNull();
    expect(isEligible(line("a", ""))).toBe(false);
    expect(isEligible(line("a", "  "))).toBe(false);
  });

  it("a negative or malformed count is null, invalid, and never eligible", () => {
    for (const text of ["-5", "-0,5", "abc", "5abc", "5-3"]) {
      expect(countedQuantity(line("a", text))).toBeNull();
      expect(isInvalidCount(line("a", text))).toBe(true);
      expect(isEligible(line("a", text))).toBe(false);
    }
    expect(isInvalidCount(line("a", ""))).toBe(false);
    expect(isInvalidCount(line("a", "  "))).toBe(false);
    expect(isInvalidCount(line("a", "0"))).toBe(false);
    expect(countedQuantity(line("a", "1 250,5"))).toBe(1250.5);
  });

  it("a typed 0 is a real count", () => {
    expect(countedQuantity(line("a", "0"))).toBe(0);
    expect(isEligible(line("a", "0"))).toBe(true);
    expect(countedQuantity(line("a", "0,0"))).toBe(0);
  });

  it("an applied line is no longer eligible nor unsaved", () => {
    const applied = line("a", "5", { operationId: "op", applied: { delta: -5 } });
    expect(isEligible(applied)).toBe(false);
    expect(hasUnsavedWork([applied])).toBe(false);
    expect(hasUnsavedWork([line("a", "5", { operationId: "op", applied: { error: "x" } })])).toBe(
      true
    );
    expect(hasUnsavedWork([line("a", "")])).toBe(false);
  });
});

describe("mergeProducts", () => {
  it("keeps typed quantity, operation id and applied state of lines already there", () => {
    const typed = line("a", "7", { operationId: "op-1", applied: { error: "timeout" } });
    const merged = mergeProducts([typed], [product("a", 99), product("b")]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(typed);
    expect(merged[1]).toEqual({ product: product("b"), counted: "" });
  });

  it("loading the same list twice adds no duplicates", () => {
    const once = mergeProducts([], [product("a"), product("b"), product("a")]);
    expect(once.map((l) => l.product.id)).toEqual(["a", "b"]);
    expect(mergeProducts(once, [product("a"), product("b")])).toBe(once);
  });

  it("adds to existing lines instead of replacing them", () => {
    const merged = mergeProducts([line("x", "1")], [product("a")]);
    expect(merged.map((l) => l.product.id)).toEqual(["x", "a"]);
    expect(merged[0].counted).toBe("1");
  });
});

describe("progress and filter", () => {
  const lines = [line("a", "3"), line("b", ""), line("c", "0"), line("d", " ")];

  it("counts X of Y, a typed 0 included", () => {
    expect(countProgress(lines)).toEqual({ counted: 2, total: 4 });
    expect(countProgress([])).toEqual({ counted: 0, total: 0 });
  });

  it("shows only not-counted lines, keeping the one being worked on", () => {
    expect(visibleLines(lines, true, null).map((l) => l.product.id)).toEqual(["b", "d"]);
    expect(visibleLines(lines, true, "a").map((l) => l.product.id)).toEqual(["a", "b", "d"]);
    expect(visibleLines(lines, false, null)).toBe(lines);
  });
});

describe("runInBatches", () => {
  it("never runs more than the batch size at once and keeps order", async () => {
    let running = 0;
    let peak = 0;
    const out = await runInBatches([...Array(23).keys()], 5, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return n * 2;
    });
    expect(peak).toBe(5);
    expect(out).toEqual([...Array(23).keys()].map((n) => n * 2));
  });

  it("handles an empty list and a silly size", async () => {
    expect(await runInBatches([], 5, async (n) => n)).toEqual([]);
    expect(await runInBatches([1, 2], 0, async (n) => n)).toEqual([1, 2]);
  });
});

describe("confirmPreview", () => {
  it("lists every line when there are few", () => {
    const batch = [line("a", "10"), line("b", "3")];
    const preview = confirmPreview(batch);
    expect(preview).toMatchObject({ total: 2, differing: 1, summaryOnly: false });
    expect(preview.shown).toBe(batch);
  });

  it("summarises a long list: totals, the first few that differ, the rest hidden", () => {
    const batch = Array.from({ length: CONFIRM_FULL_LIST_MAX + 12 }, (_, i) =>
      line(`p${i}`, i % 4 === 0 ? "10" : "2")
    );
    const preview = confirmPreview(batch);
    expect(preview.summaryOnly).toBe(true);
    expect(preview.total).toBe(20);
    expect(preview.differing).toBe(15);
    expect(preview.shown).toHaveLength(5);
    expect(preview.hidden).toBe(10);
    expect(preview.shown.every((l) => l.counted === "2")).toBe(true);
  });
});
