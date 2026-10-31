/**
 * A disabled BigButton used to only drop opacity to 0.5, which put white
 * text on a pale wash of the button color at roughly 2:1 contrast --
 * WCAG AA needs 4.5:1. This pins the fix: disabled renders a solid
 * background with its own full-opacity text color, for every variant, and
 * never carries the opacity-based `disabled` style a reduced-motion/
 * high-contrast setting could otherwise defeat.
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { create } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";

// WCAG 2.1 relative-luminance contrast ratio.
function expandHex(hex: string): string {
  // "#fff" -> "#ffffff"
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
}

function contrast(hexA: string, hexB: string): number {
  const luminance = (short: string) => {
    const hex = expandHex(short);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function flatten(tree: ReturnType<typeof create>) {
  return { pressable: tree.root.findByType(Pressable), text: tree.root.findByType(Text) };
}

describe.each(["primary", "secondary", "danger"] as const)("BigButton disabled (%s)", (variant) => {
  it("renders readable text, not a dimmed copy of the button", () => {
    const tree = create(<BigButton label="Go" onPress={() => {}} variant={variant} disabled />);
    const { pressable, text } = flatten(tree);

    const pressableStyle = StyleSheet.flatten(
      typeof pressable.props.style === "function"
        ? pressable.props.style({ pressed: false })
        : pressable.props.style
    );
    const textStyle = StyleSheet.flatten(text.props.style);

    // The old bug: opacity alone on the whole button, which dims the text
    // by the same amount as the background -- never do that again.
    expect(pressableStyle.opacity).toBeUndefined();

    expect(
      contrast(textStyle.color as string, pressableStyle.backgroundColor as string)
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("BigButton enabled", () => {
  it.each(["primary", "danger"] as const)("%s text on its background passes AA", (variant) => {
    const tree = create(<BigButton label="Go" onPress={() => {}} variant={variant} />);
    const { pressable, text } = flatten(tree);
    const pressableStyle = StyleSheet.flatten(
      typeof pressable.props.style === "function"
        ? pressable.props.style({ pressed: false })
        : pressable.props.style
    );
    const textStyle = StyleSheet.flatten(text.props.style);
    expect(
      contrast(textStyle.color as string, pressableStyle.backgroundColor as string)
    ).toBeGreaterThanOrEqual(4.5);
  });
});
