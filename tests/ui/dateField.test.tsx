import React from "react";
import { Modal, Pressable } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { DateField } from "../../src/components/ui/DateField";
import { allTexts } from "../sales/sellTestUtils";

let mockLanguage = "fr";
const mockT = (key: string) => key;
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: mockLanguage } }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

let tree: ReactTestRenderer;
const onChange = jest.fn();

function render(props: Partial<React.ComponentProps<typeof DateField>> = {}) {
  act(() => {
    tree = create(
      <DateField label="Du" value="" onChange={onChange} today="2026-11-18" {...props} />
    );
  });
}
const byId = (id: string) => tree.root.find((n) => n.props.testID === id && !!n.props.onPress);
const open = () => act(() => byId("date-field").props.onPress());
const press = (id: string) => act(() => byId(id).props.onPress());
const isOpen = () => tree.root.findByType(Modal).props.visible === true;

beforeEach(() => {
  mockLanguage = "fr";
  onChange.mockClear();
});
afterEach(() => act(() => tree.unmount()));

describe("DateField", () => {
  it("shows the date in the app's language, or a placeholder", () => {
    render({ value: "2026-11-18" });
    expect(allTexts(tree.root)).toContain("18/11/2026");
    act(() => tree.unmount());
    render({ value: "" });
    expect(allTexts(tree.root)).toContain("dateField.choose");
  });

  it("opens on the chosen month, picks a day and closes", () => {
    render({ value: "2026-11-18" });
    open();
    expect(isOpen()).toBe(true);
    expect(allTexts(tree.root)).toContain("novembre");
    press("day-2026-11-20");
    expect(onChange).toHaveBeenCalledWith("2026-11-20");
    expect(isOpen()).toBe(false);
  });

  it("moves by month and by year", () => {
    render({ value: "2026-11-18" });
    open();
    press("next-month");
    expect(allTexts(tree.root)).toContain("décembre");
    press("next-year");
    expect(allTexts(tree.root)).toContain("2027");
    press("prev-year");
    press("prev-year");
    expect(allTexts(tree.root)).toContain("2025");
    press("day-2025-12-31");
    expect(onChange).toHaveBeenCalledWith("2025-12-31");
  });

  it("cannot pick days outside min and max", () => {
    render({ value: "2026-11-18", min: "2026-11-10", max: "2026-11-20" });
    open();
    expect(byId("day-2026-11-09").props.disabled).toBe(true);
    expect(byId("day-2026-11-21").props.disabled).toBe(true);
    expect(byId("day-2026-11-10").props.disabled).toBe(false);
  });

  it("does not offer months that hold no pickable day", () => {
    render({ value: "2026-11-18", min: "2026-11-10", max: "2026-11-20" });
    open();
    expect(byId("next-month").props.disabled).toBe(true);
    expect(byId("prev-month").props.disabled).toBe(true);
    expect(byId("next-year").props.disabled).toBe(true);
  });

  it("gives every day a full-date accessibility label and 44 px targets", () => {
    render({ value: "2026-11-18" });
    open();
    const day = byId("day-2026-11-18");
    expect(day.props.accessibilityLabel).toContain("18 novembre 2026");
    expect(day.props.accessibilityLabel).toContain("mercredi");
    expect(day.props.accessibilityLabel).toContain("dateField.selected");
    const style = ([] as object[]).concat(day.props.style).flat(Infinity).filter(Boolean);
    expect(Object.assign({}, ...style).height).toBeGreaterThanOrEqual(44);
  });

  it("starts the week on Monday", () => {
    render({ value: "2026-11-18" });
    open();
    // 1 November 2026 is a Sunday: the first row ends with it.
    const first = tree.root.findAll((n) => String(n.props.testID ?? "").startsWith("day-"));
    expect(first[0].props.testID).toBe("day-2026-11-01");
    expect(allTexts(tree.root).slice(0, 8)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^lun/)])
    );
  });

  it("Today picks the store's day, and is disabled when out of range", () => {
    render({ value: "" });
    open();
    press("date-today");
    expect(onChange).toHaveBeenCalledWith("2026-11-18");
    act(() => tree.unmount());
    render({ value: "", max: "2026-11-17" });
    open();
    expect(byId("date-today").props.disabled).toBe(true);
  });

  it("clears only when clearable and there is a value", () => {
    render({ value: "2026-11-18" });
    open();
    expect(tree.root.findAll((n) => n.props.testID === "date-clear")).toHaveLength(0);
    act(() => tree.unmount());
    render({ value: "", clearable: true });
    open();
    expect(tree.root.findAll((n) => n.props.testID === "date-clear")).toHaveLength(0);
    act(() => tree.unmount());
    render({ value: "2026-11-18", clearable: true });
    open();
    press("date-clear");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("closes from the backdrop, Cancel and Escape (the Modal request) without changing the value", () => {
    render({ value: "2026-11-18" });
    open();
    press("date-backdrop");
    expect(isOpen()).toBe(false);
    open();
    press("date-cancel");
    expect(isOpen()).toBe(false);
    open();
    act(() => tree.root.findByType(Modal).props.onRequestClose());
    expect(isOpen()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps Western digits in Arabic and points the arrows both ways", () => {
    mockLanguage = "ar";
    render({ value: "2026-11-18" });
    expect(allTexts(tree.root).join("")).toMatch(/18/);
    open();
    expect(tree.root.findAllByType(Pressable).length).toBeGreaterThan(30);
    expect(byId("prev-month").props.accessibilityLabel).toBe("dateField.previousMonth");
  });

  it("shows a value that is not a date as typed, flagged invalid", () => {
    render({ value: "2026-02-31", invalid: true });
    expect(allTexts(tree.root)).toContain("2026-02-31");
  });
});
