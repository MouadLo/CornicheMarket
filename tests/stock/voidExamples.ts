/**
 * The two worked examples from docs/STOCK-IN-DESIGN.md section 2.1.1, as data.
 * One copy, used by the CI unit test (against the pure oracle below) and by
 * the live test (against the real SQL), so a number can't be right in one
 * and wrong in the other.
 *
 * All money is integer centimes, quantities are units.
 */
export type VoidStep =
  | { do: "receive"; qty: number; unitCost: number; as?: string }
  | { do: "sell"; qty: number }
  | { do: "void"; delivery: string }
  | { do: "expect"; stock: number; cost: number; note: string };

export type VoidExample = {
  name: string;
  steps: VoidStep[];
  // Every sale is stamped with the average cost at its moment and must keep it.
  salesKeepCost: number | null;
};

export const EXAMPLE_A: VoidExample = {
  name: "A: cost typo, some units sold (formula path)",
  salesKeepCost: 555,
  steps: [
    { do: "receive", qty: 20, unitCost: 500 },
    { do: "expect", stock: 20, cost: 500, note: "start" },
    { do: "receive", qty: 24, unitCost: 600, as: "typo" },
    // (20*500 + 24*600) / 44 = 554.5 -> 555
    { do: "expect", stock: 44, cost: 555, note: "after the typo delivery" },
    { do: "sell", qty: 4 },
    { do: "expect", stock: 40, cost: 555, note: "after selling 4" },
    { do: "void", delivery: "typo" },
    // (40*555 - 24*600) / 16 = 7800 / 16 = 487.5 -> 488
    { do: "expect", stock: 16, cost: 488, note: "after the void" },
    { do: "receive", qty: 24, unitCost: 500 },
    // (16*488 + 24*500) / 40 = 495.2 -> 495
    { do: "expect", stock: 40, cost: 495, note: "after re-entering 24 @ 5.00" },
  ],
};

export const EXAMPLE_B: VoidExample = {
  name: "B: quantity typo, stock goes negative (fallback path)",
  salesKeepCost: 691,
  steps: [
    { do: "receive", qty: 10, unitCost: 600 },
    { do: "expect", stock: 10, cost: 600, note: "start" },
    { do: "receive", qty: 100, unitCost: 700, as: "typo" },
    // (10*600 + 100*700) / 110 = 690.9 -> 691
    { do: "expect", stock: 110, cost: 691, note: "after the typo delivery" },
    { do: "sell", qty: 15 },
    { do: "expect", stock: 95, cost: 691, note: "after selling 15" },
    { do: "void", delivery: "typo" },
    // S' = 95 - 100 = -5 <= 0 -> fall back to the cost before the delivery
    { do: "expect", stock: -5, cost: 600, note: "after the void" },
    { do: "receive", qty: 10, unitCost: 700 },
    // stock was <= 0, so the receive trigger takes the new cost outright
    { do: "expect", stock: 5, cost: 700, note: "after re-entering 10 @ 7.00" },
  ],
};

export const EXAMPLES = [EXAMPLE_A, EXAMPLE_B];

/** JS mirror of public.void_line_effect, used only as a test oracle. */
export function voidLineEffect(
  stock: number,
  cost: number,
  qty: number,
  unitCost: number,
  costBefore: number
): { stock: number; cost: number } {
  const after = stock - qty;
  const remaining = stock * cost - qty * unitCost;
  return {
    stock: after,
    cost: after > 0 && remaining > 0 ? Math.round(remaining / after) : costBefore,
  };
}

/** JS mirror of apply_purchase_item, used only as a test oracle. */
export function receiveEffect(
  stock: number,
  cost: number,
  qty: number,
  unitCost: number
): { stock: number; cost: number } {
  return {
    stock: stock + qty,
    cost: stock <= 0 ? unitCost : Math.round((stock * cost + qty * unitCost) / (stock + qty)),
  };
}
