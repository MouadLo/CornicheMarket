import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { PaymentSheet } from "../../src/components/sell/PaymentSheet";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const customers = [
  { id: "c1", name: "Fatima Zahra", phone: null },
  { id: "c2", name: "Khadija Bennani", phone: null },
];
const onConfirm = jest.fn();

let tree: ReactTestRenderer;

function sheet(visible: boolean, saving = false) {
  return (
    <PaymentSheet
      visible={visible}
      totalCents={800}
      customers={customers}
      saving={saving}
      error={null}
      onClose={() => {}}
      onConfirm={onConfirm}
      onCreateCustomer={async () => null}
    />
  );
}

const label = (node: ReactTestInstance) =>
  node
    .findAllByType(Text)
    .map((text) => [text.props.children].flat().join(""))
    .join("");

function press(text: string) {
  const target = tree.root.findAllByType(Pressable).find((node) => label(node) === text);
  if (!target) throw new Error(`no button labelled "${text}"`);
  act(() => target.props.onPress());
}

function setVisible(visible: boolean, saving = false) {
  act(() => tree.update(sheet(visible, saving)));
}

beforeEach(() => {
  onConfirm.mockClear();
  act(() => {
    tree = create(sheet(true));
  });
});
afterEach(() => act(() => tree.unmount()));

it("after a credit sale, the next sale opens on cash with no customer", () => {
  press("sell.payLater");
  press("Fatima Zahra");
  press("sell.completeSale");
  expect(onConfirm).toHaveBeenLastCalledWith("credit", "c1");

  // The sale completes: the sheet closes. The next customer opens it again.
  setVisible(false);
  setVisible(true);

  press("sell.completeSale");
  expect(onConfirm).toHaveBeenLastCalledWith("cash", null);
});

it("a stale customer cannot be put on credit by a single tap on the next sale", () => {
  press("sell.payLater");
  press("Fatima Zahra");
  setVisible(false);
  setVisible(true);

  // Switching to credit again must require choosing a customer again.
  press("sell.payLater");
  const complete = tree.root
    .findAllByType(Pressable)
    .find((node) => label(node) === "sell.completeSale")!;
  expect(complete.props.disabled).toBe(true);
});

it("clears the cash received and the new-customer name too", () => {
  const input = () => tree.root.findAllByType(TextInput)[0];
  act(() => input().props.onChangeText("50"));
  expect(input().props.value).toBe("50");

  setVisible(false);
  setVisible(true);
  expect(input().props.value).toBe("");

  press("sell.payLater");
  act(() => tree.root.findAllByType(TextInput)[0].props.onChangeText("Nadia"));
  setVisible(false);
  setVisible(true);
  press("sell.payLater");
  expect(tree.root.findAllByType(TextInput)[0].props.value).toBe("");
});

it("keeps the choices while the sheet stays open (saving flips, nothing else)", () => {
  press("sell.payLater");
  press("Khadija Bennani");
  setVisible(true, true);
  setVisible(true, false);
  press("sell.completeSale");
  expect(onConfirm).toHaveBeenLastCalledWith("credit", "c2");
});
