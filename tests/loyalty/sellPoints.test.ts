import {
  earnLinesOf,
  eligibleCentsOf,
  effectiveExcludedCategoryIds,
  lineBonusPerUnit,
  lineEligible,
} from "../../src/lib/loyalty/basket";
import {
  DEFAULT_RATES,
  expectedEarn,
  maxRedeemablePoints,
  stepRedeemPoints,
} from "../../src/lib/loyalty/points";
import {
  creditCustomerOfMember,
  loyaltyPayload,
  receiptLoyaltyOf,
  type SaleMember,
} from "../../src/lib/loyalty/saleMember";
import { cashierDiscountProblem } from "../../src/lib/sales/discountLimit";
import {
  cartLineFrom,
  saleTotalWithPoints,
  validateSaleDiscounts,
  type CartLine,
} from "../../src/lib/sales/totals";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const NONE: ReadonlySet<string> = new Set();

const product = (extra: Record<string, unknown> = {}) => ({
  id: "p",
  name: "Milk",
  unit: "piece",
  selling_price_cents: 1000,
  loyalty_excluded: false,
  loyalty_bonus_points: 0,
  loyalty_bonus_until: null,
  category_id: "dairy",
  ...extra,
});
const line = (extra: Record<string, unknown> = {}, quantity = 1, discount = 0): CartLine => ({
  ...cartLineFrom(product(extra), quantity),
  discount_cents: discount,
});

describe("cartLineFrom keeps what loyalty needs", () => {
  it("is unchanged for a product the device holds no loyalty data for", () => {
    const plain = cartLineFrom(
      { id: "p", name: "Milk", unit: "piece", selling_price_cents: 700 },
      1
    );
    expect(plain).not.toHaveProperty("loyalty");
  });

  it("stores category, exclusion, bonus and Divers", () => {
    expect(
      cartLineFrom(product({ loyalty_bonus_points: 5, loyalty_bonus_until: "2027-01-01" }), 1)
        .loyalty
    ).toEqual({
      category_id: "dairy",
      excluded: false,
      bonus: 5,
      bonus_until: "2027-01-01",
      misc: false,
    });
    expect(cartLineFrom(product({ kind: "misc" }), 1).loyalty?.misc).toBe(true);
  });
});

describe("which lines earn and can be paid with points", () => {
  it("a normal line is eligible; a line the device knows nothing about too", () => {
    expect(lineEligible(line(), NONE)).toBe(true);
    expect(lineEligible({ loyalty: undefined }, NONE)).toBe(true);
  });

  it("Divers, an excluded product and an excluded category earn nothing", () => {
    expect(lineEligible(line({ kind: "misc" }), NONE)).toBe(false);
    expect(lineEligible(line({ loyalty_excluded: true }), NONE)).toBe(false);
    expect(lineEligible(line(), new Set(["dairy"]))).toBe(false);
    expect(lineEligible(line({ category_id: "water" }), new Set(["dairy"]))).toBe(true);
  });

  it("an excluded main category covers its sub-categories, not the reverse", () => {
    const categories = [
      { id: "tobacco", parent_id: null, loyalty_excluded: true },
      { id: "cigars", parent_id: "tobacco", loyalty_excluded: false },
      { id: "dairy", parent_id: null, loyalty_excluded: false },
      { id: "cheese", parent_id: "dairy", loyalty_excluded: true },
      { id: "milk", parent_id: "dairy", loyalty_excluded: false },
    ];
    expect(effectiveExcludedCategoryIds(categories).sort()).toEqual([
      "cheese",
      "cigars",
      "tobacco",
    ]);
  });

  it("the bonus runs until its end and never on an excluded product", () => {
    const promo = line({ loyalty_bonus_points: 3, loyalty_bonus_until: "2026-11-21T00:00:00Z" });
    expect(lineBonusPerUnit(promo, NOW)).toBe(3);
    expect(lineBonusPerUnit(promo, Date.parse("2026-11-22T00:00:00Z"))).toBe(0);
    const open = line({ loyalty_bonus_points: 3 });
    expect(lineBonusPerUnit(open, NOW)).toBe(3);
    const excluded = line({ loyalty_bonus_points: 3, loyalty_excluded: true });
    expect(expectedEarn(earnLinesOf([excluded], NONE, NOW), 0, DEFAULT_RATES).total).toBe(0);
  });
});

describe("earn estimate of a basket", () => {
  it("1 point per full 10 DH on eligible lines, plus bonus, none on excluded ones", () => {
    const lines = [
      line({ id: "a" }, 3), // 30.00 DH -> 3
      line({ id: "b", loyalty_excluded: true }, 5), // 50.00 DH -> 0
      line({ id: "c", kind: "misc" }, 4), // Divers -> 0
      line({ id: "d", loyalty_bonus_points: 7 }, 2, 500), // 15.00 DH -> 1, +14 bonus
    ];
    const earn = expectedEarn(earnLinesOf(lines, NONE, NOW), 0, DEFAULT_RATES);
    expect(earn).toEqual({ base: 4, bonus: 14, total: 18 });
  });

  it("an excluded category earns nothing", () => {
    const lines = [line({ category_id: "tobacco" }, 10)];
    expect(
      expectedEarn(earnLinesOf(lines, new Set(["tobacco"]), NOW), 0, DEFAULT_RATES).total
    ).toBe(0);
  });

  it("points spent are not paid for twice: they take their share off what earns", () => {
    const lines = [line({}, 10)]; // 100.00 DH
    const earn = expectedEarn(earnLinesOf(lines, NONE, NOW), 1000, DEFAULT_RATES);
    expect(earn.total).toBe(9);
  });
});

describe("what points may pay for", () => {
  it("eligible lines after their own discount only", () => {
    const lines = [
      line({ id: "a" }, 3, 200), // 28.00 DH eligible
      line({ id: "b", loyalty_excluded: true }, 5), // 50.00 DH excluded
    ];
    expect(eligibleCentsOf(lines, NONE)).toBe(2800);
  });

  it("only lines that take a sale discount: a 'no discount' product is paid in money", () => {
    // Found in the browser: points spread over too few discountable lines gave
    // them a negative share, and a return refunded money paid with points.
    const lines = [
      line({ id: "d", discountable: true }, 1), // 10.00 DH, takes discounts
      line({ id: "n", discountable: false }, 3), // 30.00 DH, no discount
    ];
    expect(eligibleCentsOf(lines, NONE)).toBe(1000);
  });

  it("minus the manual sale discount spread over the same lines", () => {
    const lines = [
      line({ id: "d", discountable: true }, 1), // 10.00 DH
      line({ id: "n", discountable: false }, 3),
    ];
    expect(eligibleCentsOf(lines, NONE, 400)).toBe(600);
    expect(eligibleCentsOf(lines, NONE, 1500)).toBe(0);
  });

  it("when no line takes discounts, the discount is spread over every line", () => {
    const lines = [
      line({ id: "a", discountable: false }, 2),
      line({ id: "b", discountable: false }, 1),
    ];
    expect(eligibleCentsOf(lines, NONE)).toBe(3000);
  });

  it("an excluded line that takes discounts still pays nothing with points", () => {
    const lines = [
      line({ id: "d", discountable: true }, 1),
      line({ id: "x", discountable: true, loyalty_excluded: true }, 2),
    ];
    expect(eligibleCentsOf(lines, NONE)).toBe(1000);
  });

  it("the cap is the balance, then the eligible value, and 0 under the minimum", () => {
    // 34.00 DH eligible = 340 points; balance 500
    expect(maxRedeemablePoints(500, 3400, DEFAULT_RATES)).toBe(340);
    // balance 120 caps it
    expect(maxRedeemablePoints(120, 3400, DEFAULT_RATES)).toBe(120);
    // eligible 8.00 DH = 80 points < 100 minimum
    expect(maxRedeemablePoints(500, 800, DEFAULT_RATES)).toBe(0);
    // nothing eligible
    expect(maxRedeemablePoints(500, 0, DEFAULT_RATES)).toBe(0);
  });
});

describe("stepRedeemPoints", () => {
  const rates = { minRedeemPoints: 100 };
  it("steps by 10, never above the max", () => {
    expect(stepRedeemPoints(100, "up", 134, rates)).toBe(110);
    expect(stepRedeemPoints(130, "up", 134, rates)).toBe(134);
    expect(stepRedeemPoints(134, "up", 134, rates)).toBe(134);
  });
  it("from 0 the first step up is the minimum", () => {
    expect(stepRedeemPoints(0, "up", 340, rates)).toBe(100);
  });
  it("going down from the minimum removes the points; never below it otherwise", () => {
    expect(stepRedeemPoints(100, "down", 340, rates)).toBe(0);
    expect(stepRedeemPoints(105, "down", 340, rates)).toBe(0);
    expect(stepRedeemPoints(134, "down", 340, rates)).toBe(124);
  });
  it("nothing can be spent when the max is 0", () => {
    expect(stepRedeemPoints(50, "up", 0, rates)).toBe(0);
  });
});

describe("the points discount and the cashier's limit", () => {
  const lines = [line({}, 10)]; // 100.00 DH, discountable
  const limits = { percent: 5, maxCents: 2000 }; // 5.00 DH here

  it("the points value is taken off the total but is not a cashier discount", () => {
    expect(saleTotalWithPoints(lines, 300, 1000)).toBe(10000 - 300 - 1000);
    // The limit is checked on the manual part only: 3.00 DH is within 5.00 DH,
    // even though 10.00 DH of points came off as well.
    expect(cashierDiscountProblem(lines, 300, limits)).toBeNull();
    // Counting points would have been an error (and is what must not happen).
    expect(cashierDiscountProblem(lines, 300 + 1000, limits)).not.toBeNull();
  });

  it("the whole discount must still fit in the basket", () => {
    expect(validateSaleDiscounts(lines, 300 + 1000)).toBeNull();
    expect(validateSaleDiscounts(lines, 10001)).toBe("sale");
  });
});

describe("what the sale carries", () => {
  const online: SaleMember = {
    customerId: "c1",
    phone: "+212612345678",
    name: "Sara",
    balance: 340,
    cardToken: "TOKEN",
    pending: false,
  };
  const offline: SaleMember = {
    customerId: null,
    phone: "+212612345678",
    name: null,
    balance: null,
    cardToken: null,
    pending: true,
  };

  it("no member: nothing at all", () => {
    expect(loyaltyPayload(null, null)).toBeUndefined();
  });
  it("an online member is sent by id, without the card token unless points are spent", () => {
    expect(loyaltyPayload(online, null)).toEqual({ customer_id: "c1" });
    expect(loyaltyPayload(online, { points: 0, cardToken: "TOKEN" })).toEqual({
      customer_id: "c1",
    });
    expect(loyaltyPayload(online, { points: 120, cardToken: "TOKEN" })).toEqual({
      customer_id: "c1",
      redeem_points: 120,
      card_token: "TOKEN",
    });
  });
  it("an offline member is sent by phone", () => {
    expect(loyaltyPayload(offline, null)).toEqual({ phone: "+212612345678" });
  });

  it("a member's credit sale is theirs", () => {
    expect(creditCustomerOfMember(online, [])).toBe("c1");
    const customers = [
      { id: "x", phone: "0661 00 00 00" },
      { id: "y", phone: "06 12 34 56 78" },
      { id: "z", phone: null },
    ];
    expect(creditCustomerOfMember(offline, customers)).toBe("y");
    expect(creditCustomerOfMember(offline, [customers[0], customers[2]])).toBeNull();
  });

  it("receipt: balance after = before - spent + earned when it was known", () => {
    const loyalty = receiptLoyaltyOf({
      member: online,
      redeemedPoints: 100,
      earnedPoints: 12,
      rates: DEFAULT_RATES,
    });
    expect(loyalty).toEqual({
      discountCents: 1000,
      pointsEarned: 12,
      balanceAfterPoints: 252,
      balanceAfterValueCents: 2520,
      pending: false,
    });
  });
  it("receipt: an offline member has no balance and is pending", () => {
    expect(
      receiptLoyaltyOf({
        member: offline,
        redeemedPoints: 0,
        earnedPoints: 4,
        rates: DEFAULT_RATES,
      })
    ).toEqual({
      discountCents: 0,
      pointsEarned: 4,
      balanceAfterPoints: null,
      balanceAfterValueCents: null,
      pending: true,
    });
  });
});
