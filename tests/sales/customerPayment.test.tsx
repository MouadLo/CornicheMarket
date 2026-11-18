/**
 * The shared payment box (clients list and customer history). The money path:
 * one paymentId per payment being entered, reused on retry after a network
 * failure, cleared on success, cancel, switching customer or any amount change
 * (typing or "Pay in full"); recording is blocked above the balance.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { TextInput } from "react-native";

import { CustomerPaymentAction } from "../../src/components/clients/CustomerPaymentAction";
import { allTexts, pressableByText } from "./sellTestUtils";

let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `pay-${++mockUuid}` }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "fr" },
  }),
}));

let tree: ReactTestRenderer;
const onRecord = jest.fn();
const onRecorded = jest.fn();

const element = (customerId = "c1", balance = 1250) => (
  <CustomerPaymentAction
    customerId={customerId}
    balanceCents={balance}
    onRecord={onRecord}
    onRecorded={onRecorded}
  />
);
const render = (customerId?: string) => {
  act(() => {
    tree = create(element(customerId));
  });
};
const type = (value: string) =>
  act(() => tree.root.findByType(TextInput).props.onChangeText(value));
const press = async (label: string) =>
  act(async () => pressableByText(tree.root, label).props.onPress());
const recordButton = () => pressableByText(tree.root, "credit.recordPayment");
const open = () => press("credit.recordPaymentButton");

beforeEach(() => {
  mockUuid = 0;
  onRecord.mockReset();
  onRecord.mockResolvedValue(undefined);
  onRecorded.mockReset();
});
afterEach(() => act(() => tree.unmount()));

describe("CustomerPaymentAction", () => {
  it("records the amount in centimes with one id, then reports success", async () => {
    render();
    await open();
    type("5");
    await press("credit.recordPayment");
    expect(onRecord).toHaveBeenCalledWith("pay-1", 500);
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it("reuses the same id when retrying after a failure, and uses a new one after success", async () => {
    render();
    await open();
    type("5");
    onRecord.mockRejectedValueOnce(new Error("network"));
    await press("credit.recordPayment");
    expect(allTexts(tree.root)).toContain("network");
    await press("credit.recordPayment");
    expect(onRecord.mock.calls.map((c) => c[0])).toEqual(["pay-1", "pay-1"]);
    expect(onRecorded).toHaveBeenCalledTimes(1);

    await open();
    type("5");
    await press("credit.recordPayment");
    expect(onRecord.mock.calls[2][0]).toBe("pay-2");
  });

  it("starts a new id when the amount is typed differently after a failure", async () => {
    render();
    await open();
    type("5");
    onRecord.mockRejectedValueOnce(new Error("network"));
    await press("credit.recordPayment");
    type("6");
    await press("credit.recordPayment");
    expect(onRecord.mock.calls.map((c) => c[0])).toEqual(["pay-1", "pay-2"]);
  });

  it("'Pay in full' fills the exact balance, clears the id, and does not record by itself", async () => {
    render();
    await open();
    type("5");
    onRecord.mockRejectedValueOnce(new Error("network"));
    await press("credit.recordPayment");
    await press(`credit.payInFull · ⁦1250⁩`.replace("1250", "12.50 DH"));
    expect(tree.root.findByType(TextInput).props.value).toBe("12.50");
    expect(onRecord).toHaveBeenCalledTimes(1);
    await press("credit.recordPayment");
    expect(onRecord).toHaveBeenLastCalledWith("pay-2", 1250);
  });

  it("starts a new id after cancel", async () => {
    render();
    await open();
    type("5");
    onRecord.mockRejectedValueOnce(new Error("network"));
    await press("credit.recordPayment");
    await press("credit.cancelPayment");
    await open();
    type("5");
    await press("credit.recordPayment");
    expect(onRecord.mock.calls.map((c) => c[0])).toEqual(["pay-1", "pay-2"]);
  });

  it("starts a new id and closes when the customer changes", async () => {
    render("c1");
    await open();
    type("5");
    onRecord.mockRejectedValueOnce(new Error("network"));
    await press("credit.recordPayment");
    act(() => tree.update(element("c2")));
    expect(() => recordButton()).toThrow();
    await open();
    type("5");
    await press("credit.recordPayment");
    expect(onRecord.mock.calls.map((c) => c[0])).toEqual(["pay-1", "pay-2"]);
  });

  it("blocks an amount above the balance, with a message", async () => {
    render();
    await open();
    type("12.51");
    expect(recordButton().props.disabled).toBe(true);
    expect(allTexts(tree.root).join("|")).toContain("credit.amountOver");
    await press("credit.recordPayment");
    expect(onRecord).not.toHaveBeenCalled();
  });

  it.each(["0", "-3", "abc", ""])("blocks %p", async (value) => {
    render();
    await open();
    type(value);
    expect(recordButton().props.disabled).toBe(true);
    await press("credit.recordPayment");
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("allows exactly the balance", async () => {
    render();
    await open();
    type("12.50");
    expect(recordButton().props.disabled).toBe(false);
  });
});
