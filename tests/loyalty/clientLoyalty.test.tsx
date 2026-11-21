/**
 * Loyalty on the Clients screens: member badge and balances in the list, and the
 * loyalty block of a customer's page (owner sees phone, balance, history and the
 * actions; a cashier can enrol and share the card they just made, nothing more).
 */
import React from "react";
import { Linking, Switch, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import CreditScreen from "../../app/(app)/clients/index";
import { BigButton } from "../../src/components/BigButton";
import { LoyaltyPanel } from "../../src/components/clients/LoyaltyPanel";
import { cardUrl, whatsappCardLink } from "../../src/lib/loyalty/card";
import { allTexts } from "../sales/sellTestUtils";

let mockRole: "owner" | "cashier" = "owner";
const mockIsMember = jest.fn();
const mockSettings = jest.fn();
const mockDetails = jest.fn();
const mockLedger = jest.fn();
const mockBalances = jest.fn();
const mockMemberIds = jest.fn();
const mockAdjust = jest.fn();
const mockReset = jest.fn();
const mockJoin = jest.fn();
const mockUpdatePhone = jest.fn();
const mockConfirm = jest.fn();
const mockToast = jest.fn();
const mockCustomerBalances = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    R.useEffect(cb, [cb]);
  },
}));
jest.mock("react-i18next", () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key);
  const value = { t, i18n: { language: "fr" } };
  return { useTranslation: () => value };
});
jest.mock("lucide-react-native", () => {
  const R = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => R.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: mockRole } }),
}));
jest.mock("../../src/lib/loyalty/origin", () => ({ appOrigin: () => "https://shop.example" }));
jest.mock("../../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
  showToast: (...a: unknown[]) => mockToast(...a),
}));
jest.mock("../../src/lib/loyalty/queries", () => ({
  fetchIsMember: (...a: unknown[]) => mockIsMember(...a),
  fetchLoyaltySettings: (...a: unknown[]) => mockSettings(...a),
  fetchMemberDetails: (...a: unknown[]) => mockDetails(...a),
  fetchLoyaltyLedger: (...a: unknown[]) => mockLedger(...a),
  fetchLoyaltyBalances: (...a: unknown[]) => mockBalances(...a),
  fetchMemberIds: (...a: unknown[]) => mockMemberIds(...a),
  loyaltyAdjust: (...a: unknown[]) => mockAdjust(...a),
  loyaltyResetCard: (...a: unknown[]) => mockReset(...a),
  loyaltyJoin: (...a: unknown[]) => mockJoin(...a),
  updateCustomerPhone: (...a: unknown[]) => mockUpdatePhone(...a),
}));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchCustomerBalances: (...a: unknown[]) => mockCustomerBalances(...a),
  recordCustomerPayment: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "id" }));

const details = {
  customerId: "c1",
  name: "Sara",
  phoneE164: "+212612345678",
  cardToken: "AbCdEfGhIjKlMnOpQrStUv",
  joinedAt: "2026-11-01T00:00:00Z",
  balance: 34,
};
const ledger = [
  {
    id: "l5",
    saleId: null,
    kind: "adjust",
    points: 50,
    bonusPoints: 0,
    note: "gesture",
    createdAt: "2026-11-05T10:00:00Z",
  },
  {
    id: "l4",
    saleId: "s2",
    kind: "sale_adjust",
    points: -3,
    bonusPoints: 0,
    note: "return",
    createdAt: "2026-11-04T10:00:00Z",
  },
  {
    id: "l3",
    saleId: "s2",
    kind: "redeem",
    points: -100,
    bonusPoints: 0,
    note: null,
    createdAt: "2026-11-03T10:00:00Z",
  },
  {
    id: "l2",
    saleId: "s1",
    kind: "earn",
    points: 20,
    bonusPoints: 8,
    note: null,
    createdAt: "2026-11-02T10:00:00Z",
  },
  {
    id: "l1",
    saleId: null,
    kind: "adjust",
    points: 10,
    bonusPoints: 0,
    note: "welcome",
    createdAt: "2026-11-01T10:00:00Z",
  },
];

let tree: ReactTestRenderer;
const renderPanel = async (props: Partial<React.ComponentProps<typeof LoyaltyPanel>> = {}) => {
  await act(async () => {
    tree = create(
      <LoyaltyPanel customerId="c1" customerPhone={null} isOwner timeZone="UTC" {...props} />
    );
  });
};
const texts = () => allTexts(tree.root).join("|");
const button = (label: string) =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === label);
const press = (label: string) =>
  act(async () => {
    await button(label)!.props.onPress();
  });
const input = (label: string) =>
  tree.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;

let openUrl: jest.SpyInstance;
beforeEach(() => {
  mockRole = "owner";
  [
    mockIsMember,
    mockSettings,
    mockDetails,
    mockLedger,
    mockBalances,
    mockMemberIds,
    mockAdjust,
    mockReset,
    mockJoin,
    mockUpdatePhone,
    mockConfirm,
    mockToast,
    mockCustomerBalances,
  ].forEach((m) => m.mockReset());
  mockIsMember.mockResolvedValue(true);
  mockSettings.mockResolvedValue({ pointValueCents: 10 });
  mockDetails.mockResolvedValue(details);
  mockLedger.mockResolvedValue(ledger);
  mockAdjust.mockResolvedValue(84);
  mockReset.mockResolvedValue("NEWTOKENNEWTOKENNEWTOK");
  mockUpdatePhone.mockResolvedValue(undefined);
  openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(() => {
  act(() => tree?.unmount());
  openUrl.mockRestore();
});

describe("customer page: owner, member", () => {
  it("shows the balance in DH first, the phone, and a readable history", async () => {
    await renderPanel();
    const all = allTexts(tree.root);
    const balance = all.find((x) => x.includes("3.40 DH"))!;
    expect(balance.indexOf("3.40 DH")).toBeLessThan(balance.indexOf("loyalty.pointsMany"));
    expect(texts()).toContain("06 12 34 56 78");
    expect(texts()).toContain("loyalty.kindAdjust");
    expect(texts()).toContain("loyalty.kindSaleAdjust");
    expect(texts()).toContain("loyalty.kindRedeem");
    expect(texts()).toContain("loyalty.kindEarn");
    expect(texts()).toContain("loyalty.kindWelcome");
    expect(texts()).toContain("gesture");
    // The earn row says how much of it was bonus.
    expect(texts()).toContain("loyalty.includesBonus");
    expect(texts()).toContain("⁦+50⁩");
    expect(texts()).toContain("⁦−100⁩");
  });

  it("sends the card by WhatsApp with the card's own address", async () => {
    await renderPanel();
    await press("loyalty.shareWhatsapp");
    const message = `loyalty.whatsappMessage${JSON.stringify({
      url: cardUrl("https://shop.example", details.cardToken),
    })}`;
    expect(openUrl).toHaveBeenCalledWith(whatsappCardLink(details.phoneE164, message));
  });

  it("adjusts points with a required note, then reloads", async () => {
    await renderPanel();
    await press("loyalty.adjustButton");
    act(() => input("loyalty.adjustPoints").props.onChangeText("+50"));
    await press("loyalty.adjustSave");
    expect(mockAdjust).not.toHaveBeenCalled();
    expect(texts()).toContain("loyalty.errAdjustNote");
    act(() => input("loyalty.adjustNote").props.onChangeText("gesture commercial"));
    await press("loyalty.adjustSave");
    expect(mockAdjust).toHaveBeenCalledWith("c1", 50, "gesture commercial");
    expect(mockDetails).toHaveBeenCalledTimes(2);
  });

  it("will not take the balance below zero", async () => {
    await renderPanel();
    await press("loyalty.adjustButton");
    act(() => input("loyalty.adjustPoints").props.onChangeText("-35"));
    act(() => input("loyalty.adjustNote").props.onChangeText("erreur"));
    await press("loyalty.adjustSave");
    expect(mockAdjust).not.toHaveBeenCalled();
    expect(texts()).toContain("loyalty.errAdjustBelowZero");
  });

  it("a new card asks first; on no nothing changes, on yes the new link is used", async () => {
    mockConfirm.mockResolvedValueOnce(false);
    await renderPanel();
    await press("loyalty.resetButton");
    expect(mockConfirm.mock.calls[0][0].tone).toBe("danger");
    expect(mockReset).not.toHaveBeenCalled();

    mockConfirm.mockResolvedValueOnce(true);
    await press("loyalty.resetButton");
    expect(mockReset).toHaveBeenCalledWith("c1");
    await press("loyalty.shareWhatsapp");
    const sent = decodeURIComponent(openUrl.mock.calls[0][0] as string);
    expect(sent).toContain("/card/NEWTOKENNEWTOKENNEWTOK");
    expect(sent).not.toContain(details.cardToken);
  });

  it("a failed adjustment is explained", async () => {
    mockAdjust.mockRejectedValueOnce(new Error("Only an owner can adjust points"));
    await renderPanel();
    await press("loyalty.adjustButton");
    act(() => input("loyalty.adjustPoints").props.onChangeText("5"));
    act(() => input("loyalty.adjustNote").props.onChangeText("x"));
    await press("loyalty.adjustSave");
    expect(texts()).toContain("errors.permission");
  });
});

describe("customer page: not a member", () => {
  beforeEach(() => mockIsMember.mockResolvedValue(false));

  it("needs a valid phone and the consent tick, and joins with them", async () => {
    mockJoin.mockResolvedValue({
      customerId: "c1",
      name: "Sara",
      balance: 0,
      cardToken: "TOKTOKTOKTOKTOKTOKTOK",
      created: false,
    });
    await renderPanel({ customerPhone: null });
    await press("loyalty.enrollButton");
    expect(texts()).toContain("loyalty.errPhone");
    act(() => input("loyalty.phoneLabel").props.onChangeText("06 12 34 56 78"));
    await press("loyalty.enrollButton");
    expect(texts()).toContain("loyalty.errConsent");
    expect(mockJoin).not.toHaveBeenCalled();

    act(() => tree.root.findByType(Switch).props.onValueChange(true));
    await press("loyalty.enrollButton");
    expect(mockUpdatePhone).toHaveBeenCalledWith("c1", "06 12 34 56 78");
    expect(mockJoin).toHaveBeenCalledWith("+212612345678", null, true);
    expect(mockToast).toHaveBeenCalled();
  });

  it("does not rewrite a phone the customer already has", async () => {
    mockJoin.mockResolvedValue({
      customerId: "c1",
      name: "Sara",
      balance: 0,
      cardToken: "TOKTOKTOKTOKTOKTOKTOK",
      created: false,
    });
    await renderPanel({ customerPhone: "0612345678" });
    expect(input("loyalty.phoneLabel").props.value).toBe("0612345678");
    act(() => tree.root.findByType(Switch).props.onValueChange(true));
    await press("loyalty.enrollButton");
    expect(mockUpdatePhone).not.toHaveBeenCalled();
    expect(mockJoin).toHaveBeenCalled();
  });

  it("a cashier who just enrolled someone can share their card, and sees no balance", async () => {
    mockJoin.mockResolvedValue({
      customerId: "c1",
      name: "Sara",
      balance: 12,
      cardToken: "TOKTOKTOKTOKTOKTOKTOK",
      created: false,
    });
    await renderPanel({ isOwner: false, customerPhone: "0612345678" });
    act(() => tree.root.findByType(Switch).props.onValueChange(true));
    await press("loyalty.enrollButton");
    expect(texts()).toContain("loyalty.cardReady");
    await press("loyalty.shareWhatsapp");
    expect(decodeURIComponent(openUrl.mock.calls[0][0] as string)).toContain(
      "/card/TOKTOKTOKTOKTOKTOKTOK"
    );
    expect(texts()).not.toContain("DH");
    expect(mockDetails).not.toHaveBeenCalled();
    expect(mockLedger).not.toHaveBeenCalled();
  });

  it("goes to the other customer when the number already belonged to one", async () => {
    mockJoin.mockResolvedValue({
      customerId: "other",
      name: "Omar",
      balance: 0,
      cardToken: "TOKTOKTOKTOKTOKTOKTOK",
      created: false,
    });
    const onJoinedElsewhere = jest.fn();
    await renderPanel({ customerPhone: "0612345678", onJoinedElsewhere });
    act(() => tree.root.findByType(Switch).props.onValueChange(true));
    await press("loyalty.enrollButton");
    expect(onJoinedElsewhere).toHaveBeenCalledWith("other");
  });

  it("a refused join says why in words", async () => {
    mockJoin.mockRejectedValue(new Error("Not a valid Moroccan phone number"));
    await renderPanel({ customerPhone: "0612345678" });
    act(() => tree.root.findByType(Switch).props.onValueChange(true));
    await press("loyalty.enrollButton");
    expect(texts()).toContain("loyalty.errPhone");
  });
});

describe("customer page: cashier, existing member", () => {
  it("shows only the badge: no phone, balance, history, adjust or new card, and asks for none of it", async () => {
    await renderPanel({ isOwner: false });
    expect(texts()).toContain("loyalty.memberBadge");
    expect(texts()).toContain("loyalty.memberCashierNote");
    expect(texts()).not.toContain("DH");
    expect(button("loyalty.adjustButton")).toBeUndefined();
    expect(button("loyalty.resetButton")).toBeUndefined();
    expect(button("loyalty.shareWhatsapp")).toBeUndefined();
    expect(mockDetails).not.toHaveBeenCalled();
    expect(mockLedger).not.toHaveBeenCalled();
  });
});

describe("customer page: load failure", () => {
  it("says so with a retry rather than pretending the customer is not a member", async () => {
    mockIsMember.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await renderPanel();
    expect(texts()).toContain("loyalty.errLoad");
    expect(button("loyalty.enrollButton")).toBeUndefined();
  });
});

describe("clients list", () => {
  const bal = (id: string, name: string, balance: number) => ({
    id,
    name,
    phone: null,
    credit_total_cents: Math.max(balance, 0),
    paid_total_cents: 0,
    balance_cents: balance,
    credit_limit_cents: 30000,
    credit_available_cents: 30000,
    credit_limit_override_cents: null,
  });
  const renderList = async () => {
    await act(async () => {
      tree = create(<CreditScreen />);
    });
  };

  beforeEach(() => {
    mockCustomerBalances.mockResolvedValue([bal("c1", "Sara", 1000), bal("c2", "Omar", 0)]);
    mockMemberIds.mockResolvedValue(new Set(["c1"]));
    mockBalances.mockResolvedValue(new Map([["c1", 34]]));
  });

  it("owner: a badge on members only, with the balance in DH first", async () => {
    await renderList();
    expect(allTexts(tree.root).filter((x) => x === "loyalty.memberBadge")).toHaveLength(1);
    expect(allTexts(tree.root).some((x) => x.startsWith("⁦3.40 DH⁩ ·"))).toBe(true);
  });

  it("cashier: the badge, never the balance, and the balances are not even requested", async () => {
    mockRole = "cashier";
    await renderList();
    expect(allTexts(tree.root).filter((x) => x === "loyalty.memberBadge")).toHaveLength(1);
    expect(allTexts(tree.root).join("|")).not.toContain("3.40 DH");
    expect(mockBalances).not.toHaveBeenCalled();
  });

  it("the list still shows when loyalty cannot be read", async () => {
    mockMemberIds.mockRejectedValue(new Error("boom"));
    mockBalances.mockRejectedValue(new Error("boom"));
    await renderList();
    expect(allTexts(tree.root).join("|")).toContain("Sara");
    expect(allTexts(tree.root)).not.toContain("loyalty.memberBadge");
  });
});
