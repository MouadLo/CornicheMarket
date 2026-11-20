/**
 * The return sheet: pick lines and quantities (capped at what remains, decimal
 * kilos for weighed products), a reason, a refund method that fits the sale,
 * and see the refund before confirming.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { TextInput } from "react-native";

import { ReturnSheet, type ReturnSubmission } from "../../src/components/sell/ReturnSheet";
import type { SaleLine } from "../../src/lib/sales/queries";
import type { ReturnableLine } from "../../src/lib/sales/returns";
import { allTexts, pressableByText } from "./sellTestUtils";

const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: "fr" } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

const lines: SaleLine[] = [
  {
    id: "l1",
    sale_id: "s1",
    product_name: "Lait",
    unit: "piece",
    quantity: 3,
    unit_price_cents: 1000,
    discount_cents: 0,
    line_total_cents: 3000,
  },
  {
    id: "l2",
    sale_id: "s1",
    product_name: "Tomates",
    unit: "kg",
    quantity: 1.25,
    unit_price_cents: 2000,
    discount_cents: 0,
    line_total_cents: 2500,
  },
  {
    id: "l3",
    sale_id: "s1",
    product_name: "Sucre",
    unit: "piece",
    quantity: 1,
    unit_price_cents: 700,
    discount_cents: 0,
    line_total_cents: 700,
  },
];
// Lait: paid 2657 of 3000 after its share of the sale discount; Sucre is already
// fully returned and must not be offered.
const returnable: ReturnableLine[] = [
  { saleItemId: "l1", quantity: 3, returnedQuantity: 0, paidCents: 2657, refundedCents: 0 },
  { saleItemId: "l2", quantity: 1.25, returnedQuantity: 0, paidCents: 2500, refundedCents: 0 },
  { saleItemId: "l3", quantity: 1, returnedQuantity: 1, paidCents: 700, refundedCents: 700 },
];

let tree: ReactTestRenderer;
const onSubmit = jest.fn<void, [ReturnSubmission]>();
const onClose = jest.fn();
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined as unknown as ReactTestRenderer;
  onSubmit.mockReset();
  onClose.mockReset();
});

const render = async (
  paymentMethod: "cash" | "card" | "credit" = "cash",
  error: string | null = null
) => {
  await act(async () => {
    tree = create(
      <ReturnSheet
        visible
        paymentMethod={paymentMethod}
        lines={lines}
        returnable={returnable}
        saving={false}
        error={error}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );
  });
};
const byLabel = (label: string) =>
  tree.root.find(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function"
  );
const more = (name: string) => byLabel(`returns.more:${JSON.stringify({ name })}`);
const less = (name: string) => byLabel(`returns.less:${JSON.stringify({ name })}`);
const joined = () => allTexts(tree.root).join("|");
const money = (text: string) => `⁦${text}⁩`;
const confirmButton = () => pressableByText(tree.root, "returns.confirm");

describe("return sheet", () => {
  it("lists only the lines that still have something to return", async () => {
    await render();
    expect(joined()).toContain("Lait");
    expect(joined()).toContain("Tomates");
    expect(joined()).not.toContain("Sucre");
  });

  it("caps the stepper at what remains", async () => {
    await render();
    for (let i = 0; i < 5; i += 1) await act(async () => more("Lait").props.onPress());
    expect(joined()).toContain("|3|");
    expect(more("Lait").props.disabled).toBe(true);
    expect(joined()).toContain(`returns.total|${money("26.57 DH")}`);
  });

  it("previews the refund as the paid share, with the remainder on the last unit", async () => {
    await render();
    await act(async () => more("Lait").props.onPress());
    expect(joined()).toContain(`returns.lineRefund:{"amount":"${money("8.86 DH")}"}`);
    await act(async () => more("Lait").props.onPress());
    // 2 of 3: round(2657 * 2 / 3) = 1771.
    expect(joined()).toContain(`returns.lineRefund:{"amount":"${money("17.71 DH")}"}`);
    await act(async () => less("Lait").props.onPress());
    expect(joined()).toContain(`returns.lineRefund:{"amount":"${money("8.86 DH")}"}`);
  });

  it("takes decimal kilos for a weighed product and caps them", async () => {
    await render();
    const input = tree.root.findByType(TextInput);
    await act(async () => input.props.onChangeText("0.5"));
    expect(joined()).toContain(`returns.lineRefund:{"amount":"${money("10.00 DH")}"}`);
    await act(async () => tree.root.findByType(TextInput).props.onChangeText("9"));
    expect(tree.root.findByType(TextInput).props.value).toBe("1.25");
    expect(joined()).toContain(`returns.lineRefund:{"amount":"${money("25.00 DH")}"}`);
  });

  it("needs a line and a reason before it can be confirmed", async () => {
    await render();
    expect(confirmButton().props.disabled).toBe(true);
    await act(async () => more("Lait").props.onPress());
    expect(confirmButton().props.disabled).toBe(true);
    await act(async () => pressableByText(tree.root, "returns.reasonDamaged").props.onPress());
    expect(confirmButton().props.disabled).toBe(false);
  });

  it("makes 'other' say why", async () => {
    await render();
    await act(async () => more("Lait").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.reasonOther").props.onPress());
    expect(confirmButton().props.disabled).toBe(true);
    const note = tree.root
      .findAllByType(TextInput)
      .find((n) => n.props.accessibilityLabel === "sell.voidRequestNote");
    await act(async () => note?.props.onChangeText("melted"));
    expect(confirmButton().props.disabled).toBe(false);
  });

  it("offers cash or card for a cash sale, defaulting to its own method", async () => {
    await render("card");
    expect(joined()).toContain("returns.refundCash");
    expect(joined()).toContain("returns.refundCard");
    expect(joined()).not.toContain("returns.refundCredit");
    await act(async () => more("Lait").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.reasonDamaged").props.onPress());
    await act(async () => confirmButton().props.onPress());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submission = onSubmit.mock.calls[0][0];
    expect(submission.method).toBe("card");
    expect(submission.reason).toBe("damaged");
    expect(submission.summary).toEqual({
      items: [{ saleItemId: "l1", quantity: 1, refundCents: 886 }],
      totalCents: 886,
    });
  });

  it("lets the owner switch a cash sale to a card refund", async () => {
    await render("cash");
    await act(async () => more("Lait").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.reasonWrongItem").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.refundCard").props.onPress());
    await act(async () => confirmButton().props.onPress());
    expect(onSubmit.mock.calls[0][0].method).toBe("card");
  });

  it("a credit sale can only lower the customer's debt", async () => {
    await render("credit");
    expect(joined()).toContain("returns.creditHint");
    expect(joined()).toContain("returns.refundCredit");
    expect(joined()).not.toContain("returns.refundCash");
    expect(joined()).not.toContain("returns.refundCard");
    await act(async () => more("Lait").props.onPress());
    await act(async () => pressableByText(tree.root, "returns.reasonChangedMind").props.onPress());
    await act(async () => confirmButton().props.onPress());
    expect(onSubmit.mock.calls[0][0].method).toBe("credit");
  });

  it("shows a refusal inside the sheet and closes on cancel", async () => {
    await render("cash", "returns.errTooMany");
    expect(joined()).toContain("returns.errTooMany");
    await act(async () => pressableByText(tree.root, "common.cancel").props.onPress());
    expect(onClose).toHaveBeenCalled();
  });
});
