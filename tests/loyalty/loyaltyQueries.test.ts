/**
 * The loyalty calls: what is sent to the server, how each answer is mapped, and
 * that a server error is thrown (never turned into an empty answer).
 */
import {
  fetchIsMember,
  fetchLoyaltyBalances,
  fetchLoyaltyLedger,
  fetchLoyaltyReport,
  fetchLoyaltySettings,
  fetchMemberDetails,
  fetchPublicCard,
  loyaltyAdjust,
  loyaltyCardCustomer,
  loyaltyCheckRedeem,
  loyaltyJoin,
  loyaltyLookup,
  loyaltyResetCard,
  mapRedeemCheck,
  ratesFromSettings,
  setCategoryLoyaltyExcluded,
  updateLoyaltySettings,
  updateProductLoyalty,
} from "../../src/lib/loyalty/queries";
import { mapLoyaltyReport, memberSalesShare } from "../../src/lib/loyalty/report";

const mockRpc = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
let mockSelectResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};

jest.mock("../../src/lib/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = (...a: unknown[]) => {
    mockSelect(...a);
    return chain;
  };
  chain.update = (...a: unknown[]) => {
    mockUpdate(...a);
    return chain;
  };
  chain.eq = (...a: unknown[]) => {
    mockEq(...a);
    return chain;
  };
  chain.not = () => chain;
  chain.order = () => chain;
  chain.range = () => Promise.resolve(mockSelectResult);
  chain.maybeSingle = () => Promise.resolve(mockSelectResult);
  // update(...).eq(...) is awaited directly
  chain.then = (resolve: (v: unknown) => void) => resolve(mockSelectResult);
  return {
    supabase: {
      rpc: (...a: unknown[]) => mockRpc(...a),
      from: () => chain,
    },
  };
});

beforeEach(() => {
  [mockRpc, mockUpdate, mockEq, mockSelect].forEach((m) => m.mockReset());
  mockSelectResult = { data: null, error: null };
});

describe("rpc wrappers", () => {
  it("loyaltyJoin sends the phone, name and consent and maps the card", async () => {
    mockRpc.mockResolvedValue({
      data: [{ customer_id: "c1", name: "Sara", balance: 5, card_token: "tok", created: true }],
      error: null,
    });
    await expect(loyaltyJoin("+212612345678", "Sara", true)).resolves.toEqual({
      customerId: "c1",
      name: "Sara",
      balance: 5,
      cardToken: "tok",
      created: true,
    });
    expect(mockRpc).toHaveBeenCalledWith("loyalty_join", {
      p_phone: "+212612345678",
      p_name: "Sara",
      p_consent: true,
    });
  });

  it("throws the server's message instead of returning nothing", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "The customer must agree to join" },
    });
    await expect(loyaltyJoin("+212612345678", null, false)).rejects.toThrow("agree to join");
  });

  it("loyaltyLookup maps a member and returns null when nobody has the number", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ customer_id: "c1", name: "Omar", balance: 0, is_member: false }],
      error: null,
    });
    await expect(loyaltyLookup("0612345678")).resolves.toEqual({
      customerId: "c1",
      name: "Omar",
      balance: 0,
      isMember: false,
    });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(loyaltyLookup("0612345678")).resolves.toBeNull();
  });

  it("loyaltyCardCustomer is null for an unknown card", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(loyaltyCardCustomer("nope")).resolves.toBeNull();
    mockRpc.mockResolvedValueOnce({
      data: [{ customer_id: "c1", name: "Lina", balance: 34 }],
      error: null,
    });
    await expect(loyaltyCardCustomer("tok")).resolves.toEqual({
      customerId: "c1",
      name: "Lina",
      balance: 34,
    });
  });

  it("loyaltyCheckRedeem maps ok, reason, balance and value", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, reason: "over_balance", balance: 40, value_cents: 500 },
      error: null,
    });
    await expect(loyaltyCheckRedeem("c1", 50, "tok")).resolves.toEqual({
      ok: false,
      reason: "over_balance",
      balance: 40,
      valueCents: 500,
    });
    expect(mockRpc).toHaveBeenCalledWith("loyalty_check_redeem", {
      p_customer_id: "c1",
      p_points: 50,
      p_card_token: "tok",
    });
    expect(mapRedeemCheck({ ok: true, reason: null, balance: 120, value_cents: 1000 }).ok).toBe(
      true
    );
  });

  it("fetchPublicCard maps the card, leaves out nothing it needs, and gives null for an unknown token", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        first_name: "Amina",
        balance_points: 34,
        balance_value_cents: 340,
        point_value_cents: 10,
        cents_per_point: 1500,
        history: [{ created_at: "2026-11-01T10:00:00Z", kind: "earn", points: 12 }],
      },
      error: null,
    });
    await expect(fetchPublicCard("tok")).resolves.toEqual({
      firstName: "Amina",
      balancePoints: 34,
      balanceValueCents: 340,
      pointValueCents: 10,
      centsPerPoint: 1500,
      history: [{ createdAt: "2026-11-01T10:00:00Z", kind: "earn", points: 12 }],
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchPublicCard("gone")).resolves.toBeNull();
  });

  it("a card with no first name keeps firstName null", async () => {
    mockRpc.mockResolvedValue({
      data: {
        first_name: null,
        balance_points: 0,
        balance_value_cents: 0,
        point_value_cents: 10,
        history: [],
      },
      error: null,
    });
    expect((await fetchPublicCard("tok"))?.firstName).toBeNull();
  });

  it("owner calls: adjust returns the new balance, reset the new token, details and balances map", async () => {
    mockRpc.mockResolvedValueOnce({ data: 75, error: null });
    await expect(loyaltyAdjust("c1", 25, "gesture")).resolves.toBe(75);
    expect(mockRpc).toHaveBeenLastCalledWith("loyalty_adjust", {
      p_customer_id: "c1",
      p_points: 25,
      p_note: "gesture",
    });
    mockRpc.mockResolvedValueOnce({ data: "newtoken", error: null });
    await expect(loyaltyResetCard("c1")).resolves.toBe("newtoken");
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          customer_id: "c1",
          name: "Sara",
          phone_e164: "+212612345678",
          card_token: "tok",
          joined_at: "2026-11-01T00:00:00Z",
          balance: 9,
        },
      ],
      error: null,
    });
    await expect(fetchMemberDetails("c1")).resolves.toEqual({
      customerId: "c1",
      name: "Sara",
      phoneE164: "+212612345678",
      cardToken: "tok",
      joinedAt: "2026-11-01T00:00:00Z",
      balance: 9,
    });
    mockRpc.mockResolvedValueOnce({
      data: [
        { customer_id: "c1", balance: 9 },
        { customer_id: "c2", balance: 120 },
      ],
      error: null,
    });
    const balances = await fetchLoyaltyBalances();
    expect(balances.get("c2")).toBe(120);
    expect(balances.size).toBe(2);
  });

  it("report_loyalty is asked for the range and mapped", async () => {
    mockRpc.mockResolvedValue({
      data: {
        points_earned: 500,
        points_bonus: 40,
        points_adjusted: -5,
        points_redeemed: 100,
        value_redeemed_cents: 1000,
        members_total: 30,
        members_new: 4,
        member_sales_count: 12,
        member_sales_cents: 25000,
        all_sales_cents: 100000,
        top_members: [{ name: "Sara", sales_cents: 9000, points_balance: 90 }],
        top_bonus_products: [{ product_name: "Lait", bonus_points: 40 }],
      },
      error: null,
    });
    const report = await fetchLoyaltyReport(
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-08T00:00:00Z")
    );
    expect(mockRpc).toHaveBeenCalledWith("report_loyalty", {
      p_from: "2026-11-01T00:00:00.000Z",
      p_to: "2026-11-08T00:00:00.000Z",
    });
    expect(report.valueRedeemedCents).toBe(1000);
    expect(report.topMembers).toEqual([{ name: "Sara", salesCents: 9000, pointsBalance: 90 }]);
    expect(report.topBonusProducts).toEqual([{ productName: "Lait", bonusPoints: 40 }]);
    expect(memberSalesShare(report)).toBe(25);
  });
});

describe("report mapping", () => {
  it("an empty answer is all zeros and no lists, and the share is unknown without sales", () => {
    const report = mapLoyaltyReport(null);
    expect(report.pointsEarned).toBe(0);
    expect(report.topMembers).toEqual([]);
    expect(report.topBonusProducts).toEqual([]);
    expect(memberSalesShare(report)).toBeNull();
  });

  it("the member share never goes below 0 and keeps one decimal", () => {
    expect(
      memberSalesShare({ ...mapLoyaltyReport(null), memberSalesCents: -50, allSalesCents: 1000 })
    ).toBe(0);
    expect(
      memberSalesShare({ ...mapLoyaltyReport(null), memberSalesCents: 1, allSalesCents: 3 })
    ).toBe(33.3);
  });
});

describe("settings, exclusions and tables", () => {
  it("fetchLoyaltySettings maps the columns, and a missing row gives the defaults (off)", async () => {
    mockSelectResult = {
      data: {
        loyalty_enabled: true,
        loyalty_cents_per_point: "1500",
        loyalty_point_value_cents: 20,
        loyalty_min_redeem_points: 50,
        loyalty_daily_review_points: 80,
        loyalty_welcome_points: 10,
      },
      error: null,
    };
    const settings = await fetchLoyaltySettings();
    expect(settings).toEqual({
      enabled: true,
      centsPerPoint: 1500,
      pointValueCents: 20,
      minRedeemPoints: 50,
      dailyReviewPoints: 80,
      welcomePoints: 10,
    });
    expect(ratesFromSettings(settings)).toEqual({
      centsPerPoint: 1500,
      pointValueCents: 20,
      minRedeemPoints: 50,
    });
    mockSelectResult = { data: null, error: null };
    expect((await fetchLoyaltySettings()).enabled).toBe(false);
  });

  it("updateLoyaltySettings writes every column on the singleton row", async () => {
    await updateLoyaltySettings({
      enabled: true,
      centsPerPoint: 1000,
      pointValueCents: 10,
      minRedeemPoints: 100,
      dailyReviewPoints: 100,
      welcomePoints: 5,
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      loyalty_enabled: true,
      loyalty_cents_per_point: 1000,
      loyalty_point_value_cents: 10,
      loyalty_min_redeem_points: 100,
      loyalty_daily_review_points: 100,
      loyalty_welcome_points: 5,
    });
    expect(mockEq).toHaveBeenCalledWith("singleton", true);
  });

  it("a failed write throws", async () => {
    mockSelectResult = { data: null, error: { message: "permission denied" } };
    await expect(setCategoryLoyaltyExcluded("cat", true)).rejects.toThrow("permission denied");
  });

  it("writes a category's exclusion and a product's loyalty fields", async () => {
    await setCategoryLoyaltyExcluded("cat1", true);
    expect(mockUpdate).toHaveBeenLastCalledWith({ loyalty_excluded: true });
    expect(mockEq).toHaveBeenLastCalledWith("id", "cat1");
    await updateProductLoyalty("p1", {
      loyalty_excluded: false,
      loyalty_bonus_points: 20,
      loyalty_bonus_until: "2026-12-01T00:00:00.000Z",
    });
    expect(mockUpdate).toHaveBeenLastCalledWith({
      loyalty_excluded: false,
      loyalty_bonus_points: 20,
      loyalty_bonus_until: "2026-12-01T00:00:00.000Z",
    });
  });

  it("maps the ledger rows and the membership flag", async () => {
    mockSelectResult = {
      data: [
        {
          id: "l1",
          sale_id: "s1",
          kind: "earn",
          points: 12,
          bonus_points: 4,
          note: null,
          created_at: "2026-11-02T10:00:00Z",
        },
      ],
      error: null,
    };
    await expect(fetchLoyaltyLedger("c1")).resolves.toEqual([
      {
        id: "l1",
        saleId: "s1",
        kind: "earn",
        points: 12,
        bonusPoints: 4,
        note: null,
        createdAt: "2026-11-02T10:00:00Z",
      },
    ]);
    mockSelectResult = { data: { loyalty_joined_at: "2026-11-01T00:00:00Z" }, error: null };
    await expect(fetchIsMember("c1")).resolves.toBe(true);
    mockSelectResult = { data: { loyalty_joined_at: null }, error: null };
    await expect(fetchIsMember("c1")).resolves.toBe(false);
  });
});
