import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { CartLineRow } from "../../src/components/sell/CartLineRow";
import type { CartLine } from "../../src/lib/sales/totals";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ar" } }),
}));

const line: CartLine = {
  product_id: "p1",
  name: "Coca",
  unit: "piece",
  quantity: 2,
  unit_price_cents: 700,
  discount_cents: 50,
  unit_cost_cents: null,
  discountable: true,
};

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

function allText(): string {
  return tree.root
    .findAllByType(Text)
    .map((n) => [n.props.children].flat(Infinity).join(""))
    .join("\n");
}

it("keeps the basket unit price and discount left to right inside an Arabic line", () => {
  act(() => {
    tree = create(<CartLineRow line={line} onChange={() => {}} onRemove={() => {}} />);
  });
  const text = allText();
  expect(text).toContain("⁦7.00 DH⁩ /");
  expect(text).toContain("⁦−0.50 DH⁩");
});
