import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { PaymentSheet } from "../../src/components/sell/PaymentSheet";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const customers = [
  { id: "c1", name: "Fatima Zahra", phone: null, balance_cents: 12000 },
  { id: "c2", name: "Khadija Bennani", phone: null, balance_cents: 0 },
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

// A customer chip reads "Name" or "Name" + "sell.owes": match on the name.
const chipLabel = (node: ReactTestInstance) => label(node).replace("sell.owes", "");

const keys = (text: string) => {
  for (const ch of text) {
    const key = tree.root.findByProps({ testID: `cash-key-${ch}` });
    act(() => key.props.onPress());
  }
};
const entry = () => label(tree.root.findByProps({ testID: "cash-entry" }));

function press(text: string) {
  // The main button reads "Complete sale", or names the customer on Pay Later.
  const matches = (node: ReactTestInstance) =>
    chipLabel(node) === text ||
    (text === "sell.completeSale" && label(node).startsWith("sell.putOnCredit"));
  const target = tree.root.findAllByType(Pressable).find(matches);
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
  expect(onConfirm).toHaveBeenLastCalledWith("credit", "c1", 0);

  // The sale completes: the sheet closes. The next customer opens it again.
  setVisible(false);
  setVisible(true);

  press("sell.completeSale");
  expect(onConfirm).toHaveBeenLastCalledWith("cash", null, 0);
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
  keys("50");
  expect(entry()).toBe("50");

  setVisible(false);
  setVisible(true);
  expect(entry()).toBe("—");

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
  expect(onConfirm).toHaveBeenLastCalledWith("credit", "c2", 0);
});

describe("the change handed to the sale", () => {
  it("passes what to give back for a cash sale", () => {
    // The sheet in this file is opened with a total of 8.00 DH: 100 given is 92.00 back.
    keys("100");
    press("sell.completeSale");
    expect(onConfirm.mock.calls.at(-1)).toEqual(["cash", null, 9200]);
  });

  it("is 0 for an exact amount, an empty field, and any other method", () => {
    press("sell.completeSale");
    expect(onConfirm.mock.calls.at(-1)![2]).toBe(0);
    keys("100");
    press("sell.payLater");
    press("Fatima Zahra");
    press("sell.completeSale");
    expect(onConfirm.mock.calls.at(-1)).toEqual(["credit", "c1", 0]);
  });
});

describe("the cash keypad (C9)", () => {
  it("types an amount with centimes and refuses a third decimal", () => {
    keys("12.505");
    expect(entry()).toBe("12.50");
  });

  it("backspace removes the last key", () => {
    keys("12");
    act(() => tree.root.findByProps({ testID: "cash-key-back" }).props.onPress());
    expect(entry()).toBe("1");
  });

  it("the exact amount button fills the total and gives no change", () => {
    press("sell.exactAmount");
    expect(entry()).toBe("8.00");
    press("sell.completeSale");
    expect(onConfirm.mock.calls.at(-1)).toEqual(["cash", null, 0]);
  });

  it("a note button fills that note", () => {
    press("20.00");
    expect(entry()).toBe("20.00");
    press("sell.completeSale");
    expect(onConfirm.mock.calls.at(-1)).toEqual(["cash", null, 1200]);
  });

  it("a short amount blocks the sale", () => {
    keys("5");
    const complete = tree.root
      .findAllByType(Pressable)
      .find((node) => label(node) === "sell.completeSale")!;
    expect(complete.props.disabled).toBe(true);
  });
});

describe("Pay Later (C10)", () => {
  it("shows what a customer already owes, and nothing for a clear account", () => {
    press("sell.payLater");
    const fatima = tree.root
      .findAllByType(Pressable)
      .find((node) => label(node).startsWith("Fatima"))!;
    expect(label(fatima)).toContain("sell.owes");
    const khadija = tree.root
      .findAllByType(Pressable)
      .find((node) => label(node).startsWith("Khadija"))!;
    expect(label(khadija)).not.toContain("sell.owes");
  });

  it("says why the button is disabled, then names the customer on it", () => {
    press("sell.payLater");
    expect(
      tree.root.findAllByType(Text).some((t) => t.props.children === "sell.chooseCustomer")
    ).toBe(true);
    press("Khadija Bennani");
    expect(
      tree.root.findAllByType(Text).some((t) => t.props.children === "sell.chooseCustomer")
    ).toBe(false);
    const confirm = tree.root
      .findAllByType(Pressable)
      .find((node) => label(node).startsWith("sell.putOnCredit"));
    expect(confirm).toBeDefined();
  });

  it("typing a name that exists selects that customer instead of creating one", async () => {
    const create = jest.fn(async () => null);
    act(() =>
      tree.update(
        <PaymentSheet
          visible
          totalCents={800}
          customers={customers}
          saving={false}
          error={null}
          onClose={() => {}}
          onConfirm={onConfirm}
          onCreateCustomer={create}
        />
      )
    );
    press("sell.payLater");
    act(() => tree.root.findAllByType(TextInput)[0].props.onChangeText("  fatima   zahra "));
    await act(async () => {
      tree.root
        .findAllByType(Pressable)
        .find((node) => label(node) === "common.add")!
        .props.onPress();
    });
    expect(create).not.toHaveBeenCalled();
    press("sell.putOnCredit");
  });
});

describe("card: was it accepted?", () => {
  const texts = () => label(tree.root);
  const pressable = (text: string) =>
    tree.root.findAllByType(Pressable).find((node) => label(node) === text);

  it("shows the instruction and the two answers, not the normal complete button", () => {
    press("sell.paymentCard");
    expect(texts()).toContain("sell.cardInstruction");
    expect(pressable("sell.cardAccepted")).toBeDefined();
    expect(pressable("sell.cardDeclined")).toBeDefined();
    expect(pressable("sell.completeSale")).toBeUndefined();
    expect(pressable("common.back")).toBeDefined();
  });

  it("accepted records the card sale once", () => {
    press("sell.paymentCard");
    press("sell.cardAccepted");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("card", null, 0);
  });

  it("declined records nothing and says so", () => {
    press("sell.paymentCard");
    press("sell.cardDeclined");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(texts()).toContain("sell.cardDeclinedMessage");
    expect(pressable("sell.cardAccepted")).toBeDefined();
  });

  it("the declined message clears on switching method", () => {
    press("sell.paymentCard");
    press("sell.cardDeclined");
    press("sell.payLater");
    press("sell.paymentCard");
    expect(texts()).not.toContain("sell.cardDeclinedMessage");
  });

  it("the declined message does not survive reopening the sheet", () => {
    press("sell.paymentCard");
    press("sell.cardDeclined");
    setVisible(false);
    setVisible(true);
    press("sell.paymentCard");
    expect(texts()).not.toContain("sell.cardDeclinedMessage");
  });

  it("saving disables both answers", () => {
    press("sell.paymentCard");
    setVisible(true, true);
    expect(pressable("common.saving")!.props.disabled).toBe(true);
    expect(pressable("sell.cardDeclined")!.props.disabled).toBe(true);
  });

  it("cash and pay later keep the normal button and no card answers", () => {
    expect(pressable("sell.completeSale")).toBeDefined();
    expect(pressable("sell.cardAccepted")).toBeUndefined();
    press("sell.payLater");
    expect(pressable("sell.cardAccepted")).toBeUndefined();
    expect(pressable("sell.cardDeclined")).toBeUndefined();
  });

  it("card then cash still sends the cash change", () => {
    press("sell.paymentCard");
    press("sell.paymentCash");
    keys("100");
    press("sell.completeSale");
    expect(onConfirm.mock.calls.at(-1)).toEqual(["cash", null, 9200]);
  });
});
