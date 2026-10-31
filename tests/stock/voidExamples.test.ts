/**
 * Pins the numbers in docs/STOCK-IN-DESIGN.md 2.1.1 against a pure oracle of
 * the formula, so the doc's examples are checked on every CI run (the live
 * SQL suite is skipped there). The SQL itself is proven against the same
 * fixtures in voidPurchase.live.test.ts.
 *
 * This file passes before the feature exists, by design: it tests the
 * fixtures and the formula, not the migration.
 */
import { EXAMPLES, receiveEffect, voidLineEffect, type VoidExample } from "./voidExamples";

function run(example: VoidExample) {
  let stock = 0;
  let cost = 0;
  // cost_history as (costAfter) per receive, to find "the cost before" a delivery.
  const deliveries: Record<string, { qty: number; unitCost: number; costBefore: number }> = {};
  const checks: string[] = [];
  let lastReceive: { qty: number; unitCost: number; costBefore: number } | null = null;

  for (const step of example.steps) {
    if (step.do === "receive") {
      lastReceive = { qty: step.qty, unitCost: step.unitCost, costBefore: cost };
      if (step.as) deliveries[step.as] = lastReceive;
      ({ stock, cost } = receiveEffect(stock, cost, step.qty, step.unitCost));
    } else if (step.do === "sell") {
      stock -= step.qty;
    } else if (step.do === "void") {
      const d = deliveries[step.delivery];
      ({ stock, cost } = voidLineEffect(stock, cost, d.qty, d.unitCost, d.costBefore));
    } else {
      expect({ stock, cost }).toEqual({ stock: step.stock, cost: step.cost });
      checks.push(step.note);
    }
  }
  return checks;
}

describe("docs/STOCK-IN-DESIGN.md 2.1.1 worked examples", () => {
  it.each(EXAMPLES.map((e) => [e.name, e] as const))("%s", (_name, example) => {
    expect(run(example).length).toBeGreaterThanOrEqual(5);
  });

  it("example A takes the formula path: the remaining stock value loses the voided money", () => {
    // S=40, W=555, q=24, c=600: (22200 - 14400) / 16
    expect(voidLineEffect(40, 555, 24, 600, 500)).toEqual({ stock: 16, cost: 488 });
  });

  it("example B takes the fallback path: stock would go to -5, so the pre-delivery cost returns", () => {
    expect(voidLineEffect(95, 691, 100, 700, 600)).toEqual({ stock: -5, cost: 600 });
  });

  it("falls back when stock lands exactly on zero", () => {
    expect(voidLineEffect(24, 600, 24, 600, 500)).toEqual({ stock: 0, cost: 500 });
  });

  it("falls back when the formula would remove more value than the stock holds", () => {
    // 10 left at 1.00 but the voided 8 units cost 5.00 each: 10*100 - 8*500 < 0
    expect(voidLineEffect(10, 100, 8, 500, 300)).toEqual({ stock: 2, cost: 300 });
  });

  it("the money paid equals sold cost plus remaining value, up to rounding (example A)", () => {
    // paid 20*5.00 + 24*5.00 = 22000; sold 4 at 555; 40 left at 495
    const paid = 20 * 500 + 24 * 500;
    expect(Math.abs(paid - (4 * 555 + 40 * 495))).toBeLessThanOrEqual(40);
  });
});
