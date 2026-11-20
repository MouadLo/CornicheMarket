import React from "react";
import { Dimensions, FlatList, Linking, Switch, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import {
  __resetForTests as resetDialogs,
  getState,
  registerHost,
  resolveConfirm,
} from "../../src/lib/dialog/store";
import { __resetBasketForTests } from "../../src/lib/sales/basketStore";
import { enqueueSale } from "../../src/lib/sales/offlineQueue";
import { useKeyboardWedge } from "../../src/lib/sales/useKeyboardWedge";
import type { CartLine } from "../../src/lib/sales/totals";
import { allTexts, pressableByText, textOf } from "../sales/sellTestUtils";

const TOKEN = "A".repeat(22);
const OTHER_TOKEN = "B".repeat(22);
const cardUrl = (token: string) => `https://shop.test/card/${token}`;

// 10.00 DH each. Categories: tobacco is excluded by the owner.
const CATALOG: Record<string, object> = {
  milk: {
    id: "milk",
    name: "Milk",
    barcode: "m1",
    unit: "piece",
    selling_price_cents: 1000,
    category_id: "dairy",
    discountable: true,
    loyalty_excluded: false,
    loyalty_bonus_points: 0,
    loyalty_bonus_until: null,
  },
  cig: {
    id: "cig",
    name: "Cigarettes",
    barcode: "c1",
    unit: "piece",
    selling_price_cents: 5000,
    category_id: "tobacco",
    discountable: true,
    loyalty_excluded: false,
    loyalty_bonus_points: 0,
    loyalty_bonus_until: null,
  },
  gum: {
    id: "gum",
    name: "Gum",
    barcode: "g1",
    unit: "piece",
    selling_price_cents: 1000,
    category_id: "candy",
    discountable: true,
    loyalty_excluded: true,
    loyalty_bonus_points: 0,
    loyalty_bonus_until: null,
  },
  promo: {
    id: "promo",
    name: "Promo juice",
    barcode: "p1",
    unit: "piece",
    selling_price_cents: 1000,
    category_id: "drinks",
    discountable: true,
    loyalty_excluded: false,
    loyalty_bonus_points: 5,
    loyalty_bonus_until: null,
  },
  divers: {
    id: "divers",
    name: "Divers",
    barcode: "d1",
    unit: "piece",
    selling_price_cents: 1000,
    category_id: null,
    kind: "misc",
    discountable: true,
    loyalty_excluded: false,
    loyalty_bonus_points: 0,
    loyalty_bonus_until: null,
  },
};

let mockOnline = true;
let mockCameraScan = true;
const mockLookup = jest.fn();
const mockJoin = jest.fn();
const mockCardCustomer = jest.fn();
const mockCheckRedeem = jest.fn();
let mockEnabled = true;
let mockPaymentProps: Record<string, any> = {};
let mockReceipt: any = null;

jest.mock("../../src/lib/loyalty/queries", () => ({
  fetchLoyaltySettings: async () => ({
    enabled: mockEnabled,
    centsPerPoint: 1000,
    pointValueCents: 10,
    minRedeemPoints: 100,
    dailyReviewPoints: 100,
    welcomePoints: 0,
  }),
  fetchLoyaltyCategories: async () => [
    { id: "tobacco", name: "Tobacco", code: null, parent_id: null, loyalty_excluded: true },
    { id: "dairy", name: "Dairy", code: null, parent_id: null, loyalty_excluded: false },
  ],
  loyaltyLookup: (...args: unknown[]) => mockLookup(...args),
  loyaltyJoin: (...args: unknown[]) => mockJoin(...args),
  loyaltyCardCustomer: (...args: unknown[]) => mockCardCustomer(...args),
  loyaltyCheckRedeem: (...args: unknown[]) => mockCheckRedeem(...args),
}));
jest.mock("../../src/lib/loyalty/origin", () => ({ appOrigin: () => "https://shop.test" }));
jest.mock("../../src/lib/sellGrid/queries", () => ({ saveGridArrangement: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
    i18n: { language: "fr" },
  }),
}));
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("@/src/lib/day/queries", () => ({ fetchTodayClosed: async () => false }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier", full_name: "Sara" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => "" }));
jest.mock("../../src/lib/scanner/scanMode", () => ({
  useCameraScanAvailable: () => mockCameraScan,
}));
jest.mock("../../src/lib/products/offlineCache", () => ({
  getCachedGrid: async () => null,
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async (code: string) =>
    Object.values(CATALOG).find((p) => (p as { barcode: string }).barcode === code) ?? null,
  searchCachedProducts: async () => [],
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => [],
  fetchProductByBarcode: async (code: string) =>
    Object.values(CATALOG).find((p) => (p as { barcode: string }).barcode === code) ?? null,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchCustomers: async () => [{ id: "c9", name: "Other Customer", phone: "0661000000" }],
  fetchDiscountLimits: async () => ({ percent: 5, maxCents: 2000 }),
}));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn(async () => {}) }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({
    online: mockOnline,
    pending: 0,
    stuck: 0,
    syncing: false,
    sync: jest.fn(async () => {}),
  }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({
    id,
    ...payment,
    lines,
    created_at: "2026-11-20T10:00:00.000Z",
  }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({
  PaymentSheet: (props: Record<string, unknown>) => {
    mockPaymentProps = props;
    return null;
  },
}));
jest.mock("../../src/components/sell/ReceiptPanel", () => ({
  ReceiptPanel: (props: { receipt: unknown }) => {
    mockReceipt = props.receipt;
    return null;
  },
}));

let tree: ReactTestRenderer;
let unregister: () => void;

beforeAll(() => {
  jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: 1280, height: 800, scale: 1, fontScale: 1 }));
});
afterAll(() => jest.restoreAllMocks());

beforeEach(async () => {
  mockOnline = true;
  mockCameraScan = true;
  mockEnabled = true;
  mockReceipt = null;
  mockLookup.mockReset();
  mockJoin.mockReset();
  mockCardCustomer.mockReset();
  mockCheckRedeem.mockReset();
  jest.mocked(enqueueSale).mockClear();
  jest.mocked(useKeyboardWedge).mockClear();
  resetDialogs();
  unregister = registerHost();
  await __resetBasketForTests();
  await act(async () => {
    tree = create(<SellScreen />);
  });
});
afterEach(() => {
  act(() => tree.unmount());
  unregister();
  resetDialogs();
});

const scan = async (code: string) => {
  let outcome: { status: string; message: string | null } | undefined;
  await act(async () => {
    outcome = await tree.root.findByType(ContinuousScanner).props.onScanned(code);
  });
  return outcome as { status: string; message: string | null };
};
const cart = (): CartLine[] => tree.root.findByType(FlatList).props.data;
const texts = () => allTexts(tree.root);
const has = (text: string) => texts().some((value) => value.includes(text));
const hasId = (id: string) => tree.root.findAllByProps({ testID: id }).length > 0;
const press = (label: string) => act(() => pressableByText(tree.root, label).props.onPress());
const pressAsync = (label: string) =>
  act(async () => {
    pressableByText(tree.root, label).props.onPress();
  });
const textOfId = (id: string) => textOf(tree.root.findByProps({ testID: id }));
const phoneField = () =>
  tree.root
    .findAllByType(TextInput)
    .find((n) => n.props.accessibilityLabel === "loyalty.sellPhoneLabel")!;
const type = (value: string) => act(() => phoneField().props.onChangeText(value));
const wedge = () => jest.mocked(useKeyboardWedge).mock.calls.at(-1)![0] as (code: string) => void;

const MEMBER = { customerId: "c1", name: "Sara", balance: 500, isMember: true };

async function attachByPhone(phone = "0612345678") {
  mockLookup.mockResolvedValue(MEMBER);
  await press("loyalty.sellButton");
  type(phone);
  await pressAsync("loyalty.sellFind");
}

describe("the control", () => {
  it("loyalty off: no control at all, and a card QR is just an unknown code", async () => {
    mockEnabled = false;
    await act(async () => {
      tree.update(<SellScreen />);
    });
    await act(async () => {
      tree.unmount();
      tree = create(<SellScreen />);
    });
    expect(has("loyalty.sellButton")).toBe(false);
    const outcome = await scan(cardUrl(TOKEN));
    expect(mockCardCustomer).not.toHaveBeenCalled();
    expect(outcome.status).toBe("unknown");
  });

  it("loyalty on: a Fidélité button next to History and Day", () => {
    expect(has("loyalty.sellButton")).toBe(true);
  });
});

describe("a card QR on the Sell screen", () => {
  it("online: attaches the member and remembers the card as proof; no product is added", async () => {
    mockCardCustomer.mockResolvedValue({ customerId: "c1", name: "Sara", balance: 340 });
    const outcome = await scan(cardUrl(TOKEN));
    expect(mockCardCustomer).toHaveBeenCalledWith(TOKEN);
    expect(outcome.status).toBe("added");
    expect(cart()).toHaveLength(0);
    // Name, then the balance with the dirham value first.
    const chip = textOfId("member-chip");
    expect(chip).toContain("Sara");
    expect(textOfId("member-balance")).toContain("34.00 DH");
    expect(has("loyalty.sellButton")).toBe(false); // already attached
    expect(mockPaymentProps.loyalty.cardToken).toBe(TOKEN);
    expect(mockPaymentProps.loyalty.customerId).toBe("c1");
    expect(mockPaymentProps.loyalty.balance).toBe(340);
  });

  it("a USB scanner (keyboard wedge) goes the same way", async () => {
    mockCardCustomer.mockResolvedValue({ customerId: "c1", name: "Sara", balance: 340 });
    await act(async () => {
      wedge()(cardUrl(TOKEN));
    });
    expect(mockCardCustomer).toHaveBeenCalledWith(TOKEN);
    expect(hasId("member-chip")).toBe(true);
    expect(cart()).toHaveLength(0);
  });

  it("an unknown card is an error and attaches nobody", async () => {
    mockCardCustomer.mockResolvedValue(null);
    const outcome = await scan(cardUrl(OTHER_TOKEN));
    expect(outcome).toEqual({ status: "unknown", message: "loyalty.sellCardUnknown" });
    expect(hasId("member-chip")).toBe(false);
    expect(cart()).toHaveLength(0);
    expect(has("loyalty.sellCardUnknown")).toBe(true);
  });

  it("offline: says the card cannot be checked, and asks nothing", async () => {
    mockOnline = false;
    act(() => tree.update(<SellScreen />));
    const outcome = await scan(cardUrl(TOKEN));
    expect(outcome).toEqual({ status: "error", message: "loyalty.sellCardOffline" });
    expect(mockCardCustomer).not.toHaveBeenCalled();
    expect(hasId("member-chip")).toBe(false);
    expect(cart()).toHaveLength(0);
  });

  it("a product barcode is still a product", async () => {
    const outcome = await scan("m1");
    expect(outcome.status).toBe("added");
    expect(mockCardCustomer).not.toHaveBeenCalled();
    expect(cart().map((l) => l.product_id)).toEqual(["milk"]);
  });
});

describe("attaching by phone", () => {
  it("online: types the number (shown formatted), finds the member and attaches", async () => {
    await press("loyalty.sellButton");
    type("0612345678");
    expect(textOfId("loyalty-phone-formatted")).toContain("06 12 34 56 78");
    mockLookup.mockResolvedValue(MEMBER);
    await pressAsync("loyalty.sellFind");
    expect(mockLookup).toHaveBeenCalledWith("+212612345678");
    expect(textOfId("member-chip")).toContain("Sara");
    expect(textOfId("member-balance")).toContain("50.00 DH");
    // No card scanned yet: no proof, but the member is attached.
    expect(mockPaymentProps.loyalty.cardToken).toBeNull();
  });

  it("accepts +212 and other forms", async () => {
    await press("loyalty.sellButton");
    type("+212 6 12 34 56 78");
    expect(textOfId("loyalty-phone-formatted")).toContain("06 12 34 56 78");
  });

  it("a number that is not Moroccan is refused", async () => {
    await press("loyalty.sellButton");
    type("12345");
    expect(hasId("loyalty-phone-formatted")).toBe(false);
  });

  it("an unknown number offers to enrol: consent is required, then the card can be sent", async () => {
    mockLookup.mockResolvedValue(null);
    await press("loyalty.sellButton");
    type("0612345678");
    await pressAsync("loyalty.sellFind");
    expect(has("loyalty.sellJoinHint")).toBe(true);

    // Without the consent switch nothing is sent.
    await pressAsync("loyalty.sellJoinButton");
    expect(mockJoin).not.toHaveBeenCalled();
    expect(has("loyalty.errConsent")).toBe(true);

    const name = tree.root
      .findAllByType(TextInput)
      .find((n) => n.props.accessibilityLabel === "loyalty.sellNameLabel")!;
    act(() => name.props.onChangeText("Sara B."));
    act(() => tree.root.findByType(Switch).props.onValueChange(true));
    mockJoin.mockResolvedValue({
      customerId: "c1",
      name: "Sara B.",
      balance: 0,
      cardToken: TOKEN,
      created: true,
    });
    await pressAsync("loyalty.sellJoinButton");
    expect(mockJoin).toHaveBeenCalledWith("+212612345678", "Sara B.", true);
    expect(textOfId("member-chip")).toContain("Sara B.");

    // The card by WhatsApp, in the current language.
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await pressAsync("loyalty.shareWhatsapp");
    expect(open).toHaveBeenCalledTimes(1);
    const link = open.mock.calls[0][0] as string;
    expect(link.startsWith("https://wa.me/212612345678?text=")).toBe(true);
    expect(decodeURIComponent(link)).toContain(
      `loyalty.whatsappMessage|https://shop.test/card/${TOKEN}`
    );
    open.mockRestore();
  });

  it("a lookup that fails still lets the number be attached the offline way", async () => {
    mockLookup.mockRejectedValue(new Error("boom"));
    await press("loyalty.sellButton");
    type("0612345678");
    await pressAsync("loyalty.sellFind");
    expect(has("loyalty.sellLookupFailed")).toBe(true);
    await press("loyalty.sellAttachOffline");
    expect(has("loyalty.sellPending")).toBe(true);
  });

  it("offline: no lookup is possible; the number is attached and the points come at sync", async () => {
    mockOnline = false;
    act(() => tree.update(<SellScreen />));
    await press("loyalty.sellButton");
    expect(has("loyalty.sellOfflineHint")).toBe(true);
    expect(has("loyalty.sellFind")).toBe(false);
    type("0612345678");
    await press("loyalty.sellAttachOffline");
    expect(mockLookup).not.toHaveBeenCalled();
    expect(hasId("member-pending")).toBe(true);
    expect(textOfId("member-chip")).toContain("06 12 34 56 78");
    // Nothing to spend offline: no balance, no points row.
    expect(mockPaymentProps.loyalty).toBeUndefined();

    await scan("m1");
    await act(async () => {
      await mockPaymentProps.onConfirm("cash", null, 0);
    });
    const sale = jest.mocked(enqueueSale).mock.calls[0][0] as any;
    expect(sale.loyalty).toEqual({ phone: "+212612345678" });
    expect(sale.discount_cents).toBe(0);
    // The receipt promises the points at sync.
    await press("receipt.action");
    expect(mockReceipt.loyalty).toMatchObject({ pending: true, balanceAfterPoints: null });
  });
});

describe("the points this basket will earn", () => {
  it("counts eligible lines and bonus; not excluded products, categories or Divers", async () => {
    await attachByPhone();
    await scan("m1"); // 10.00 DH -> 1
    await scan("c1"); // 50.00 DH, tobacco excluded -> 0
    await scan("g1"); // 10.00 DH, product excluded -> 0
    await scan("d1"); // Divers -> 0
    expect(textOf(tree.root.findByProps({ testID: "member-earn" }))).toContain("⁦1⁩");
    await scan("p1"); // 10.00 DH, +5 bonus
    await scan("p1"); // 2 units: 20.00 DH, +10 bonus
    // Eligible: 10.00 milk + 20.00 promo = 30.00 DH -> 3 points, plus 2 x 5 bonus.
    expect(textOfId("member-earn")).toContain("13");
  });

  it("is not shown for an empty basket", async () => {
    await attachByPhone();
    expect(hasId("member-earn")).toBe(false);
  });
});

describe("what the payment sheet is given", () => {
  it("what points may pay for: eligible lines only, capped by what is due", async () => {
    mockCardCustomer.mockResolvedValue({ customerId: "c1", name: "Sara", balance: 5000 });
    await scan(cardUrl(TOKEN));
    await scan("m1"); // 10.00 DH eligible
    await scan("c1"); // 50.00 DH tobacco
    await scan("g1"); // 10.00 DH excluded product
    await scan("d1"); // Divers 10.00 DH
    expect(mockPaymentProps.totalCents).toBe(8000);
    expect(mockPaymentProps.loyalty.eligibleCents).toBe(1000);
  });

  it("a member's credit sale is theirs", async () => {
    mockCardCustomer.mockResolvedValue({ customerId: "c1", name: "Sara", balance: 340 });
    await scan(cardUrl(TOKEN));
    expect(mockPaymentProps.loyaltyCredit).toEqual({ customerId: "c1", name: "Sara" });
  });

  it("no member: no loyalty props at all", () => {
    expect(mockPaymentProps.loyalty).toBeUndefined();
    expect(mockPaymentProps.loyaltyCredit).toBeUndefined();
  });
});

describe("completing a sale with points", () => {
  async function member(balance = 5000) {
    mockCardCustomer.mockResolvedValue({ customerId: "c1", name: "Sara", balance });
    await scan(cardUrl(TOKEN));
  }
  const confirm = (...args: unknown[]) =>
    act(async () => {
      await mockPaymentProps.onConfirm(...args);
    });

  it("the points value joins the sale discount and the total follows; the member is cleared", async () => {
    await member(5000);
    for (let i = 0; i < 5; i += 1) await scan("m1"); // 50.00 DH eligible
    expect(mockPaymentProps.totalCents).toBe(5000);

    await confirm("cash", null, 0, { points: 200, cardToken: TOKEN }); // 20.00 DH of points

    expect(enqueueSale).toHaveBeenCalledTimes(1);
    const sale = jest.mocked(enqueueSale).mock.calls[0][0] as any;
    expect(sale.discount_cents).toBe(2000);
    expect(sale.total_cents).toBe(3000);
    expect(sale.customer_id).toBeNull();
    expect(sale.loyalty).toEqual({ customer_id: "c1", redeem_points: 200, card_token: TOKEN });

    // The member is gone, the basket too.
    expect(hasId("member-chip")).toBe(false);
    expect(cart()).toHaveLength(0);
    expect(has("loyalty.sellButton")).toBe(true);

    // The receipt: the points discount on its own, what was earned, the new balance.
    await press("receipt.action");
    expect(mockReceipt.discountCents).toBe(2000);
    expect(mockReceipt.totalCents).toBe(3000);
    // 30.00 DH paid in money -> 3 points; 5000 - 200 + 3
    expect(mockReceipt.loyalty).toEqual({
      discountCents: 2000,
      pointsEarned: 3,
      balanceAfterPoints: 4803,
      balanceAfterValueCents: 48030,
      pending: false,
    });
  });

  it("the cashier's discount limit does not count the points (5% of 50.00 DH is 2.50 DH)", async () => {
    await member(5000);
    for (let i = 0; i < 5; i += 1) await scan("m1");
    await confirm("cash", null, 0, { points: 200, cardToken: TOKEN });
    // 20.00 DH of points went through; a 20.00 DH cashier discount would not have.
    expect(enqueueSale).toHaveBeenCalledTimes(1);
    expect(texts().some((value) => value === "sell.saleDiscountOverLimit|20.00 DH")).toBe(false);
  });

  it("points above the cap (eligible amount, balance, minimum) are refused and nothing is queued", async () => {
    await member(5000);
    await scan("m1");
    await scan("c1"); // 10.00 eligible + 50.00 not: 100 points at most
    await confirm("cash", null, 0, { points: 101, cardToken: TOKEN });
    expect(enqueueSale).not.toHaveBeenCalled();
    expect(mockPaymentProps.error).toBe("loyalty.payCheckFailed");

    await confirm("cash", null, 0, { points: 100, cardToken: TOKEN });
    expect(enqueueSale).toHaveBeenCalledTimes(1);
  });

  it("an offline member (no balance known) cannot spend points", async () => {
    mockOnline = false;
    act(() => tree.update(<SellScreen />));
    await press("loyalty.sellButton");
    type("0612345678");
    await press("loyalty.sellAttachOffline");
    for (let i = 0; i < 5; i += 1) await scan("m1");
    await confirm("cash", null, 0, { points: 100, cardToken: TOKEN });
    expect(enqueueSale).not.toHaveBeenCalled();
  });

  it("a sale with a member but no points sends the member and the discount as typed", async () => {
    await member();
    await scan("m1");
    await confirm("card", null, 0);
    const sale = jest.mocked(enqueueSale).mock.calls[0][0] as any;
    expect(sale.loyalty).toEqual({ customer_id: "c1" });
    expect(sale.discount_cents).toBe(0);
    expect(sale.total_cents).toBe(1000);
  });

  it("a credit sale must be the member's: another customer is refused, the member's passes", async () => {
    await member();
    await scan("m1");
    await confirm("credit", "c9");
    expect(enqueueSale).not.toHaveBeenCalled();
    expect(mockPaymentProps.error).toBe("loyalty.payCreditUnknown");

    await confirm("credit", "c1");
    const sale = jest.mocked(enqueueSale).mock.calls[0][0] as any;
    expect(sale.customer_id).toBe("c1");
    expect(sale.loyalty).toEqual({ customer_id: "c1" });
  });

  it("a sale without a member carries no loyalty key at all", async () => {
    await scan("m1");
    await confirm("cash", null, 0);
    const sale = jest.mocked(enqueueSale).mock.calls[0][0] as any;
    expect(sale).not.toHaveProperty("loyalty");
    await press("receipt.action");
    expect(mockReceipt).not.toHaveProperty("loyalty");
  });
});

describe("clearing the member", () => {
  it("the chip's x detaches them", async () => {
    await attachByPhone();
    expect(hasId("member-chip")).toBe(true);
    const remove = tree.root.find(
      (n) => n.props.accessibilityLabel === "loyalty.sellRemove" && !!n.props.onPress
    );
    act(() => remove.props.onPress());
    expect(hasId("member-chip")).toBe(false);
  });

  it("emptying the basket detaches them, and Undo brings both back", async () => {
    await attachByPhone();
    await scan("m1");
    await press("sell.emptyBasket");
    await act(async () => {
      resolveConfirm(getState().confirm!.id, true);
    });
    expect(hasId("member-chip")).toBe(false);
    expect(cart()).toHaveLength(0);
    await act(async () => {
      getState().toast!.action!.onPress();
    });
    expect(hasId("member-chip")).toBe(true);
    expect(cart()).toHaveLength(1);
  });
});
