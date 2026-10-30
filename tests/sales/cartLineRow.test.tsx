import React, { useState } from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { CartLineRow } from "../../src/components/sell/CartLineRow";
import type { CartLine } from "../../src/lib/sales/totals";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const kgLine: CartLine = {
  product_id: "courgettes",
  name: "Courgettes",
  unit: "kg",
  quantity: 1,
  unit_price_cents: 900,
  discount_cents: 0,
  unit_cost_cents: null,
};

// A parent that behaves like SellScreen: it feeds every change back in as
// the line prop, which is exactly what made the field eat the "." (the
// value shown was String(line.quantity), not what the cashier typed).
let latest: CartLine = kgLine;
function Harness({ initial }: { initial: CartLine }) {
  const [line, setLine] = useState(initial);
  latest = line;
  return <CartLineRow line={line} onChange={setLine} onRemove={() => {}} />;
}

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

function weightInput(): ReturnType<ReactTestRenderer["root"]["findAllByType"]>[number] {
  return tree.root.findAllByType(TextInput)[0];
}

function typeText(text: string) {
  act(() => {
    weightInput().props.onChangeText(text);
  });
}

it("keeps the decimal point while typing 0.5 (the field showed '5' before)", () => {
  act(() => {
    tree = create(<Harness initial={{ ...kgLine, quantity: 0 }} />);
  });

  typeText("0");
  typeText("0.");
  expect(weightInput().props.value).toBe("0.");

  typeText("0.5");
  expect(weightInput().props.value).toBe("0.5");
  expect(latest.quantity).toBe(0.5);
});

it("accepts a comma decimal and three decimals: 0,125", () => {
  act(() => {
    tree = create(<Harness initial={kgLine} />);
  });

  typeText("0,");
  expect(weightInput().props.value).toBe("0,");
  typeText("0,125");
  expect(weightInput().props.value).toBe("0,125");
  expect(latest.quantity).toBe(0.125);
});

it("an emptied field is a zero quantity, which the screen refuses to charge", () => {
  act(() => {
    tree = create(<Harness initial={kgLine} />);
  });
  typeText("");
  expect(weightInput().props.value).toBe("");
  expect(latest.quantity).toBe(0);
});

it("follows an external quantity change (e.g. a second weighing added to the line)", () => {
  let setExternal: (line: CartLine) => void = () => {};
  function External() {
    const [line, setLine] = useState(kgLine);
    setExternal = setLine;
    return <CartLineRow line={line} onChange={setLine} onRemove={() => {}} />;
  }
  act(() => {
    tree = create(<External />);
  });
  act(() => setExternal({ ...kgLine, quantity: 1.75 }));
  expect(weightInput().props.value).toBe("1.75");
});
