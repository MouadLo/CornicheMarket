import React from "react";
import { StyleSheet, Text } from "react-native";
import { act, create } from "react-test-renderer";

import { MiniBarChart } from "../../src/components/reports/MiniBarChart";

let mockLang = "fr";
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLang } }),
}));

const longName = "Produits laitiers et fromages";
const points = [
  { key: "a", label: longName, value: 1000, secondary: 300 },
  { key: "b", label: "Fruits et légumes", value: 500 },
];

function render() {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<MiniBarChart points={points} secondaryLabel="Profit" />);
  });
  return tree;
}

describe("MiniBarChart", () => {
  it("shows whole category names, wrapped to two lines with an ellipsis, not cut to ten letters", () => {
    const tree = render();
    const label = tree.root.findAllByType(Text).find((n) => n.props.children === longName);
    expect(label).toBeDefined();
    expect(label?.props.numberOfLines).toBe(2);
    expect(label?.props.ellipsizeMode).toBe("tail");
  });

  it("has no text below 13 pt", () => {
    const tree = render();
    for (const node of tree.root.findAllByType(Text)) {
      const size = StyleSheet.flatten(node.props.style)?.fontSize;
      if (size !== undefined) expect(size).toBeGreaterThanOrEqual(13);
    }
  });

  it("scrolls sideways and follows the app direction", () => {
    for (const [lang, dir] of [
      ["fr", "ltr"],
      ["ar", "rtl"],
    ]) {
      mockLang = lang;
      const tree = render();
      const scroll = tree.root.find((n) => n.props.horizontal === true);
      expect(StyleSheet.flatten(scroll.props.style)?.direction).toBe(dir);
    }
    mockLang = "fr";
  });
});
