import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { PaymentSheet, type PaymentLoyalty } from "../../src/components/sell/PaymentSheet";
import type { RedeemCheck } from "../../src/lib/loyalty/queries";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));

let mockScanner: { visible: boolean; onScanned: (code: string) => void } = {
  visible: false,
  onScanned: () => {},
};
jest.mock("../../src/components/products/BarcodeScannerModal", () => ({
  BarcodeScannerModal: (props: { visible: boolean; onScanned: (code: string) => void }) => {
    mockScanner = props;
    return null;
  },
}));

const TOKEN = "A".repeat(22);
const OTHER = "B".repeat(22);
const url = (token: string) => `https://shop.test/card/${token}`;

const customers = [
  { id: "c1", name: "Sara", phone: null, balance_cents: 0 },
  { id: "c2", name: "Khadija", phone: null, balance_cents: 0 },
];
const rates = { centsPerPoint: 1000, pointValueCents: 10, minRedeemPoints: 100 };

const onConfirm = jest.fn();
const checkRedeem = jest.fn<Promise<RedeemCheck>, [string, number, string | null]>();
const resolveCard = jest.fn<Promise<{ customerId: string } | null>, [string]>();

const okCheck = (valueCents = 0): RedeemCheck => ({
  ok: true,
  reason: null,
  balance: 0,
  valueCents,
});

const loyaltyProps = (extra: Partial<PaymentLoyalty> = {}): PaymentLoyalty => ({
  customerId: "c1",
  balance: 500,
  eligibleCents: 5000,
  rates,
  cardToken: TOKEN,
  canScan: true,
  resolveCard,
  checkRedeem,
  ...extra,
});

let tree: ReactTestRenderer;

function sheet(props: {
  loyalty?: PaymentLoyalty;
  loyaltyCredit?: { customerId: string | null; name: string };
  totalCents?: number;
}) {
  return (
    <PaymentSheet
      visible
      totalCents={props.totalCents ?? 8000}
      customers={customers}
      saving={false}
      error={null}
      onClose={() => {}}
      onConfirm={onConfirm}
      onCreateCustomer={async () => null}
      loyalty={props.loyalty}
      loyaltyCredit={props.loyaltyCredit}
    />
  );
}
function mount(props: Parameters<typeof sheet>[0]) {
  act(() => {
    tree = create(sheet(props));
  });
}

const textOf = (node: ReactTestInstance) =>
  node
    .findAllByType(Text)
    .map((text) => [text.props.children].flat(Infinity).join(""))
    .join("");
const byId = (id: string) => tree.root.findByProps({ testID: id });
const hasId = (id: string) => tree.root.findAllByProps({ testID: id }).length > 0;
const allText = () => textOf(tree.root);
function pressWhere(match: (label: string) => boolean) {
  const target = tree.root
    .findAllByType(Pressable)
    .find((node) => match(textOf(node)) && !node.props.disabled);
  if (!target) throw new Error("no enabled button matches");
  act(() => target.props.onPress());
}
const press = (label: string) => pressWhere((l) => l === label);
const pressStarting = (prefix: string) => pressWhere((l) => l.startsWith(prefix));
const isDisabled = (label: string) =>
  tree.root.findAllByType(Pressable).find((node) => textOf(node) === label)?.props.disabled ===
  true;
const flush = () => act(async () => {});

beforeEach(() => {
  onConfirm.mockReset();
  checkRedeem.mockReset();
  resolveCard.mockReset();
  checkRedeem.mockResolvedValue(okCheck());
});
afterEach(() => act(() => tree.unmount()));

describe("the points row", () => {
  it("is absent without a member, or when nothing can be spent", () => {
    mount({});
    expect(hasId("loyalty-redeem")).toBe(false);
    act(() => tree.update(sheet({ loyalty: loyaltyProps({ balance: 80 }) })));
    expect(hasId("loyalty-redeem")).toBe(false); // under the 100-point minimum
    act(() => tree.update(sheet({ loyalty: loyaltyProps({ eligibleCents: 0 }) })));
    expect(hasId("loyalty-redeem")).toBe(false); // nothing eligible
  });

  it("offers up to the dirham value first, then the points", () => {
    mount({
      loyalty: loyaltyProps({
        balance: 34,
        eligibleCents: 5000,
        rates: { ...rates, minRedeemPoints: 10 },
      }),
    });
    const row = textOf(byId("loyalty-redeem"));
    expect(row).toContain("loyalty.payUse");
    expect(row).toContain("loyalty.payUpTo|⁦3.40 DH⁩|loyalty.pointsMany|⁦34⁩");
  });

  it("is capped by the eligible amount, even when the balance is larger", () => {
    // 20.00 DH eligible = 200 points; balance 500.
    mount({ loyalty: loyaltyProps({ balance: 500, eligibleCents: 2000 }) });
    expect(textOf(byId("loyalty-redeem"))).toContain("20.00 DH");
    pressStarting("loyalty.payUse");
    expect(textOf(byId("points-value"))).toContain("20.00 DH");
    expect(textOf(byId("points-value"))).toContain("200");
    act(() => byId("points-plus").props.onPress());
    expect(textOf(byId("points-value"))).toContain("200"); // never above the max
  });

  it("is capped by the balance", () => {
    mount({ loyalty: loyaltyProps({ balance: 120, eligibleCents: 5000 }) });
    pressStarting("loyalty.payUse");
    expect(textOf(byId("points-value"))).toContain("12.00 DH");
  });
});

describe("choosing the points", () => {
  it("the stepper moves by 10, Max goes back to the top, below the minimum removes them", () => {
    mount({ loyalty: loyaltyProps({ balance: 134, eligibleCents: 5000 }) });
    pressStarting("loyalty.payUse");
    const shown = () => textOf(byId("points-value"));
    expect(shown()).toContain("13.40 DH");
    act(() => byId("points-minus").props.onPress());
    expect(shown()).toContain("12.40 DH");
    act(() => byId("points-minus").props.onPress());
    act(() => byId("points-minus").props.onPress());
    expect(shown()).toContain("10.40 DH");
    act(() => byId("points-max").props.onPress());
    expect(shown()).toContain("13.40 DH");
    // 134 -> 124 -> 114 -> 104; one more would be under the 100-point
    // minimum, so it removes the points instead.
    for (let i = 0; i < 3; i += 1) act(() => byId("points-minus").props.onPress());
    expect(shown()).toContain("10.40 DH");
    act(() => byId("points-minus").props.onPress());
    expect(hasId("points-value")).toBe(false); // back to the plain row
  });

  it("the points are their own discount line and come off what is due", () => {
    mount({ loyalty: loyaltyProps({ balance: 500, eligibleCents: 5000 }), totalCents: 8000 });
    expect(allText()).toContain("80.00 DH");
    pressStarting("loyalty.payUse"); // all 500 points = 50.00 DH
    expect(textOf(byId("points-discount-line"))).toContain("loyalty.payLine");
    expect(textOf(byId("points-discount-line"))).toContain("−50.00 DH");
    expect(allText()).toContain("30.00 DH"); // due: 80 - 50
  });

  it("cash change follows the amount due after the points", () => {
    mount({ loyalty: loyaltyProps({ balance: 500, eligibleCents: 5000 }), totalCents: 8000 });
    pressStarting("loyalty.payUse");
    press("sell.exactAmount");
    expect(textOf(byId("cash-entry"))).toBe("30.00");
  });
});

describe("paying with points", () => {
  it("checks the points first, then confirms with the points and the card", async () => {
    mount({ loyalty: loyaltyProps({ balance: 500, eligibleCents: 5000 }), totalCents: 8000 });
    pressStarting("loyalty.payUse");
    press("sell.exactAmount");
    pressStarting("sell.completeSale");
    await flush();
    expect(checkRedeem).toHaveBeenCalledWith("c1", 500, TOKEN);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("cash", null, 0, { points: 500, cardToken: TOKEN });
  });

  it("without points it is the plain 3-argument confirm and asks nothing", async () => {
    mount({ loyalty: loyaltyProps(), totalCents: 8000 });
    press("sell.exactAmount");
    press("sell.completeSale");
    await flush();
    expect(checkRedeem).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith("cash", null, 0);
  });

  it("a refusal is shown translated, nothing is confirmed, and the points can be taken off", async () => {
    checkRedeem.mockResolvedValue({
      ok: false,
      reason: "over_balance",
      balance: 10,
      valueCents: 0,
    });
    mount({ loyalty: loyaltyProps({ balance: 500, eligibleCents: 5000 }), totalCents: 8000 });
    pressStarting("loyalty.payUse");
    press("sell.exactAmount");
    pressStarting("sell.completeSale");
    await flush();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(textOf(byId("points-refusal"))).toBe("loyalty.refuseOverBalance");

    press("loyalty.payRemove");
    press("sell.exactAmount");
    press("sell.completeSale");
    await flush();
    expect(onConfirm).toHaveBeenCalledWith("cash", null, 0);
  });

  it("each refusal reason has its own message", async () => {
    const reasons = {
      disabled: "loyalty.refuseDisabled",
      not_member: "loyalty.refuseNotMember",
      no_proof: "loyalty.refuseNoProof",
      over_balance: "loyalty.refuseOverBalance",
    } as const;
    for (const [reason, key] of Object.entries(reasons)) {
      checkRedeem.mockResolvedValue({
        ok: false,
        reason: reason as keyof typeof reasons,
        balance: 0,
        valueCents: 0,
      });
      mount({ loyalty: loyaltyProps(), totalCents: 8000 });
      pressStarting("loyalty.payUse");
      press("sell.exactAmount");
      pressStarting("sell.completeSale");
      await flush();
      expect(textOf(byId("points-refusal"))).toBe(key);
      act(() => tree.unmount());
    }
    checkRedeem.mockResolvedValue({
      ok: false,
      reason: "below_minimum",
      balance: 0,
      valueCents: 0,
    });
    mount({ loyalty: loyaltyProps(), totalCents: 8000 });
    pressStarting("loyalty.payUse");
    press("sell.exactAmount");
    pressStarting("sell.completeSale");
    await flush();
    expect(textOf(byId("points-refusal"))).toContain("loyalty.refuseBelowMinimum|");
  });

  it("a check that cannot be made does not let the points through", async () => {
    checkRedeem.mockRejectedValue(new Error("Failed to fetch"));
    mount({ loyalty: loyaltyProps(), totalCents: 8000 });
    pressStarting("loyalty.payUse");
    press("sell.exactAmount");
    pressStarting("sell.completeSale");
    await flush();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(textOf(byId("points-refusal"))).toBe("loyalty.payCheckFailed");
  });
});

describe("the card is the proof", () => {
  it("without a scanned card the sale cannot be completed with points", () => {
    mount({ loyalty: loyaltyProps({ cardToken: null }), totalCents: 8000 });
    pressStarting("loyalty.payUse");
    press("sell.exactAmount");
    expect(allText()).toContain("loyalty.payNeedProof");
    expect(isDisabled("sell.completeSale")).toBe(true);
    expect(allText()).toContain("loyalty.payScanCard");
    expect(hasId("points-proof-ok")).toBe(false);
  });

  it("a device that cannot scan here is told to scan before paying", () => {
    mount({ loyalty: loyaltyProps({ cardToken: null, canScan: false }) });
    pressStarting("loyalty.payUse");
    expect(allText()).toContain("loyalty.payScanHint");
    expect(allText()).not.toContain("loyalty.payScanCard");
  });

  it("scanning the member's own card is accepted", async () => {
    resolveCard.mockResolvedValue({ customerId: "c1" });
    mount({ loyalty: loyaltyProps({ cardToken: null }), totalCents: 8000 });
    pressStarting("loyalty.payUse");
    press("loyalty.payScanCard");
    expect(mockScanner.visible).toBe(true);
    await act(async () => mockScanner.onScanned(url(TOKEN)));
    expect(resolveCard).toHaveBeenCalledWith(TOKEN);
    expect(hasId("points-proof-ok")).toBe(true);
    expect(mockScanner.visible).toBe(false);

    press("sell.exactAmount");
    pressStarting("sell.completeSale");
    await flush();
    expect(onConfirm).toHaveBeenCalledWith("cash", null, 0, { points: 500, cardToken: TOKEN });
  });

  it("another customer's card is refused", async () => {
    resolveCard.mockResolvedValue({ customerId: "someone-else" });
    mount({ loyalty: loyaltyProps({ cardToken: null }) });
    pressStarting("loyalty.payUse");
    press("loyalty.payScanCard");
    await act(async () => mockScanner.onScanned(url(OTHER)));
    expect(allText()).toContain("loyalty.payScanWrongCustomer");
    expect(hasId("points-proof-ok")).toBe(false);
    expect(isDisabled("sell.completeSale")).toBe(true);
  });

  it("a code that is not a card, an unknown card, and a failed check are each said", async () => {
    mount({ loyalty: loyaltyProps({ cardToken: null }) });
    pressStarting("loyalty.payUse");

    press("loyalty.payScanCard");
    await act(async () => mockScanner.onScanned("6111245100135"));
    expect(allText()).toContain("loyalty.payScanNotCard");
    expect(resolveCard).not.toHaveBeenCalled();

    resolveCard.mockResolvedValueOnce(null);
    press("loyalty.payScanCard");
    await act(async () => mockScanner.onScanned(url(TOKEN)));
    expect(allText()).toContain("loyalty.payScanUnknown");

    resolveCard.mockRejectedValueOnce(new Error("offline"));
    press("loyalty.payScanCard");
    await act(async () => mockScanner.onScanned(url(TOKEN)));
    expect(allText()).toContain("loyalty.payScanFailed");
  });
});

describe("credit sale of a loyalty member", () => {
  it("is the member's: preselected, locked, with a note", () => {
    mount({ loyaltyCredit: { customerId: "c1", name: "Sara" } });
    press("sell.payLater");
    expect(textOf(byId("credit-locked"))).toContain("loyalty.payCreditLocked|");
    expect(textOf(byId("credit-locked"))).toContain("Sara");
    // The other customers cannot be picked, and no new one can be added.
    expect(allText()).not.toContain("Khadija");
    expect(allText()).not.toContain("sell.whoPaysLater");
    pressStarting("sell.putOnCredit");
    expect(onConfirm).toHaveBeenCalledWith("credit", "c1", 0);
  });

  it("cannot be made when the member cannot be matched to a customer", () => {
    mount({ loyaltyCredit: { customerId: null, name: "06 12 34 56 78" } });
    press("sell.payLater");
    expect(textOf(byId("credit-locked"))).toBe("loyalty.payCreditUnknown");
    expect(isDisabled("sell.completeSale")).toBe(true);
  });

  it("without a member the customer is still chosen from the list", () => {
    mount({});
    press("sell.payLater");
    expect(hasId("credit-locked")).toBe(false);
    expect(allText()).toContain("Khadija");
  });
});
