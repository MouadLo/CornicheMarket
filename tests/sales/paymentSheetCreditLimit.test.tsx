import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import { PaymentSheet } from "../../src/components/sell/PaymentSheet";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));

// Fatima owes 250 DH of a 300 DH limit; Omar has no credit; Sara has a 1000 DH
// limit of her own; Nadia was just created on this device (no figures).
const customers = [
  { id: "fatima", name: "Fatima", phone: null, balance_cents: 25000, credit_limit_cents: 30000 },
  { id: "omar", name: "Omar", phone: null, balance_cents: 0, credit_limit_cents: 0 },
  { id: "sara", name: "Sara", phone: null, balance_cents: 90000, credit_limit_cents: 100000 },
  { id: "nadia", name: "Nadia", phone: null },
];
const onConfirm = jest.fn();
let tree: ReactTestRenderer;

function sheet(props: { isOwner?: boolean; totalCents?: number; store?: number } = {}) {
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
      isOwner={props.isOwner}
      storeCreditLimitCents={props.store}
    />
  );
}

const textOf = (node: ReactTestInstance) =>
  node
    .findAllByType(Text)
    .map((text) => [text.props.children].flat().join(""))
    .join("");
const pressText = (text: string) => {
  const target = tree.root.findAllByType(Pressable).find((node) => textOf(node).startsWith(text));
  if (!target) throw new Error(`no button "${text}"`);
  act(() => target.props.onPress());
};
const standing = () => tree.root.findAllByProps({ testID: "credit-standing" })[0];
const blocked = () => tree.root.findAllByProps({ testID: "credit-blocked" })[0];
const ownerNote = () => tree.root.findAllByProps({ testID: "credit-owner-note" })[0];
const confirm = () =>
  tree.root
    .findAllByType(BigButton)
    .find((b) => String(b.props.label).startsWith("sell.putOnCredit"))!;

const render = (props?: Parameters<typeof sheet>[0]) => {
  act(() => {
    tree = create(sheet(props));
  });
  pressText("sell.payLater");
};
beforeEach(() => onConfirm.mockClear());
afterEach(() => act(() => tree.unmount()));

describe("Pay Later and the customer debt limit (cashier)", () => {
  it("shows what the customer owes and their limit", () => {
    render();
    pressText("Fatima");
    expect(textOf(standing())).toContain("sell.creditStanding|");
    expect(textOf(standing())).toContain("250.00 DH");
    expect(textOf(standing())).toContain("300.00 DH");
  });

  it("blocks the credit sale that would go over, and says how much is still available", () => {
    render();
    pressText("Fatima");
    // 250 + 80 > 300: only 50 DH left.
    expect(textOf(blocked())).toContain("sell.creditOver|");
    expect(textOf(blocked())).toContain("50.00 DH");
    expect(confirm().props.disabled).toBe(true);
    expect(ownerNote()).toBeUndefined();
  });

  it("keeps cash and card available", () => {
    render();
    pressText("Fatima");
    pressText("sell.paymentCash");
    const complete = tree.root
      .findAllByType(BigButton)
      .find((b) => b.props.label === "sell.completeSale")!;
    expect(complete.props.disabled).toBe(false);
    act(() => complete.props.onPress());
    expect(onConfirm).toHaveBeenCalledWith("cash", "fatima", 0);
  });

  it("allows a sale that stays within the limit, up to exactly the limit", () => {
    render({ totalCents: 5000 });
    pressText("Fatima");
    expect(blocked()).toBeUndefined();
    expect(confirm().props.disabled).toBe(false);
    act(() => confirm().props.onPress());
    expect(onConfirm).toHaveBeenCalledWith("credit", "fatima", 0);
  });

  it("says there is no credit for a customer whose limit is 0", () => {
    render({ totalCents: 100 });
    pressText("Omar");
    expect(textOf(blocked())).toBe("sell.creditNone");
    expect(confirm().props.disabled).toBe(true);
  });

  it("uses the customer's own higher limit", () => {
    render({ totalCents: 8000 });
    pressText("Sara");
    // 900 + 80 <= 1000
    expect(blocked()).toBeUndefined();
    expect(confirm().props.disabled).toBe(false);
  });

  it("a customer made on this device owes 0 and gets the store default", () => {
    render({ totalCents: 8000, store: 5000 });
    pressText("Nadia");
    expect(textOf(standing())).toContain("0.00 DH");
    expect(textOf(standing())).toContain("50.00 DH");
    expect(textOf(blocked())).toContain("50.00 DH");
    expect(confirm().props.disabled).toBe(true);
  });
});

describe("Pay Later and the customer debt limit (owner)", () => {
  it("sees the figures and a note, and is not blocked", () => {
    render({ isOwner: true });
    pressText("Fatima");
    expect(textOf(standing())).toContain("sell.creditStanding|");
    expect(textOf(ownerNote())).toBe("sell.creditOwnerMayExceed");
    expect(blocked()).toBeUndefined();
    expect(confirm().props.disabled).toBe(false);
    act(() => confirm().props.onPress());
    expect(onConfirm).toHaveBeenCalledWith("credit", "fatima", 0);
  });

  it("is not blocked on a customer with no credit either", () => {
    render({ isOwner: true, totalCents: 100 });
    pressText("Omar");
    expect(blocked()).toBeUndefined();
    expect(confirm().props.disabled).toBe(false);
  });
});
