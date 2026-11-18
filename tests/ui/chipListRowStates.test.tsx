import React from "react";
import { StyleSheet } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { Chip } from "../../src/components/ui/Chip";
import { ListRow } from "../../src/components/ui/ListRow";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "ar" } }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined as never;
});

const render = (el: React.ReactElement) => {
  act(() => {
    tree = create(el);
  });
  return tree;
};
const button = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.type !== "string")[0];
const styleWhen = (node: ReactTestInstance, pressed: boolean) =>
  StyleSheet.flatten(node.props.style({ pressed })) as Record<string, unknown>;
const checks = (r: ReactTestRenderer) =>
  r.root.findAll((n) => (n.type as unknown) === "Icon" && n.props.name === "Check");

describe("Chip", () => {
  it("shows a check mark only when selected, so selection is not colour alone", () => {
    expect(checks(render(<Chip label="Boissons" onPress={() => {}} />))).toHaveLength(0);
    expect(checks(render(<Chip label="Boissons" selected onPress={() => {}} />))).toHaveLength(1);
  });

  it("puts the check mark in the row's flow, before the label, so it flips in Arabic", () => {
    const r = render(<Chip label="Boissons" selected onPress={() => {}} />);
    const [check] = checks(r);
    const style = StyleSheet.flatten(button(r).props.style({ pressed: false })) as Record<
      string,
      unknown
    >;
    expect(style.flexDirection).toBe("row");
    expect(check.props.style).toBeUndefined();
    const kids = button(r).findAll(
      (n) => (n.type as unknown) === "Icon" || n.props.children === "Boissons"
    );
    expect((kids[0].type as unknown) === "Icon").toBe(true);
  });

  it("changes its look while pressed, selected or not", () => {
    for (const selected of [false, true]) {
      const r = render(<Chip label="Boissons" selected={selected} onPress={() => {}} />);
      const idle = styleWhen(button(r), false);
      const pressed = styleWhen(button(r), true);
      expect(pressed.backgroundColor).not.toBe(idle.backgroundColor);
    }
  });

  it("reports selection to assistive tech", () => {
    const r = render(<Chip label="Boissons" selected onPress={() => {}} />);
    expect(button(r).props.accessibilityState).toEqual({ selected: true });
  });
});

describe("ListRow", () => {
  it("changes its background while pressed", () => {
    const r = render(<ListRow title="Hassan" onPress={() => {}} />);
    expect(styleWhen(button(r), true).backgroundColor).not.toBe(
      styleWhen(button(r), false).backgroundColor
    );
  });
});
