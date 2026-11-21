// A stand-in for src/lib/loyalty/queries in tests that render the Sell screen
// without caring about loyalty: loyalty is off, nothing reaches Supabase.
// Use: jest.mock("../../src/lib/loyalty/queries", () => require("../fixtures/loyaltyQueriesMock").loyaltyQueriesMock);
export const loyaltyQueriesMock = {
  fetchLoyaltySettings: async () => ({
    enabled: false,
    centsPerPoint: 1000,
    pointValueCents: 10,
    minRedeemPoints: 100,
    dailyReviewPoints: 100,
    welcomePoints: 0,
  }),
  fetchLoyaltyCategories: async () => [],
  loyaltyLookup: async () => null,
  loyaltyJoin: async () => {
    throw new Error("not available");
  },
  loyaltyCardCustomer: async () => null,
  loyaltyCheckRedeem: async () => ({ ok: false, reason: null, balance: 0, valueCents: 0 }),
};
