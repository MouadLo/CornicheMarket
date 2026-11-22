import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { DiversPad } from "../../src/components/sell/DiversPad";
import { allTexts } from "../sales/sellTestUtils";

let mockLanguage = "fr";
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: mockLanguage },
  }),
}));

let tree: ReactTestRenderer;
const onConfirm = jest.fn();
const onCancel = jest.fn();

function open(props: { isOwner: boolean; maxCents?: number }) {
  act(() => {
    tree = create(
      <DiversPad
        maxCents={props.maxCents ?? 20000}
        isOwner={props.isOwner}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  });
}
const key = (k: string) => tree.root.findByProps({ testID: `divers-key-${k}` });
const press = (keys: string) => keys.split("").forEach((k) => act(() => key(k).props.onPress()));
const addButton = (): ReactTestInstance =>
  tree.root
    .findAll((n) => typeof n.props.onPress === "function" && "disabled" in n.props)
    .find((n) => allTexts(n).includes("common.add"))!;
const entry = () => allTexts(tree.root.findByProps({ testID: "divers-entry" }))[0];

beforeEach(() => {
  mockLanguage = "fr";
  onConfirm.mockClear();
  onCancel.mockClear();
});
afterEach(() => act(() => tree?.unmount()));

describe("DiversPad", () => {
  it("Ajouter is disabled at 0 and while only a zero is typed", () => {
    open({ isOwner: false });
    expect(addButton().props.disabled).toBe(true);
    press("0");
    expect(addButton().props.disabled).toBe(true);
    act(() => addButton().props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("adds the typed amount in centimes with quantity-free confirm", () => {
    open({ isOwner: false });
    press("12.5");
    expect(entry()).toContain("12.5");
    expect(addButton().props.disabled).toBe(false);
    act(() => addButton().props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(1250, null);
  });

  it("a cashier cannot go over the maximum: Ajouter is disabled and the limit is shown", () => {
    open({ isOwner: false, maxCents: 20000 });
    expect(allTexts(tree.root).join("|")).toContain("sell.diversMax");
    press("200");
    expect(addButton().props.disabled).toBe(false);
    press("0"); // 2000
    expect(addButton().props.disabled).toBe(true);
    expect(allTexts(tree.root).join("|")).toContain("sell.diversOver");
    act(() => addButton().props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => key("back").props.onPress()); // 200 again
    expect(addButton().props.disabled).toBe(false);
    press(".01"); // 200.01
    expect(addButton().props.disabled).toBe(true);
  });

  it("the owner has no maximum and no limit is shown", () => {
    open({ isOwner: true, maxCents: 20000 });
    press("500");
    expect(addButton().props.disabled).toBe(false);
    expect(allTexts(tree.root).join("|")).not.toContain("sell.diversMax");
    act(() => addButton().props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(50000, null);
  });

  it("the note is passed along trimmed, and stops at 60 characters", () => {
    open({ isOwner: false });
    const note = tree.root.findByType(TextInput);
    expect(note.props.maxLength).toBe(60);
    act(() => note.props.onChangeText("  sac plastique  "));
    press("3");
    act(() => addButton().props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(300, "sac plastique");

    act(() => tree.root.findByType(TextInput).props.onChangeText("x".repeat(90)));
    expect(tree.root.findByType(TextInput).props.value).toHaveLength(60);
  });

  it("cancel closes without adding", () => {
    open({ isOwner: false });
    press("5");
    const cancel = tree.root
      .findAll((n) => typeof n.props.onPress === "function")
      .find((n) => allTexts(n).includes("common.cancel"))!;
    act(() => cancel.props.onPress());
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("in Arabic the amount still reads left to right and the note is right aligned", () => {
    mockLanguage = "ar";
    open({ isOwner: false });
    press("12");
    const amount = entry();
    expect(amount.startsWith("⁦")).toBe(true); // LRI: an amount never flips
    expect(amount.endsWith("⁩")).toBe(true);
    const display = tree.root.findByProps({ testID: "divers-entry" }).parent!;
    expect(JSON.stringify(display.props.style)).toContain("row-reverse");
    expect(JSON.stringify(tree.root.findByType(TextInput).props.style)).toContain("right");
  });
});
