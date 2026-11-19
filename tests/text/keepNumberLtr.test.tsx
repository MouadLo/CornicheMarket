import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text as RNText } from "react-native";

import { isolateLtr, keepNumberLtr } from "../../src/lib/text/bidi";
import { Text } from "../../src/theme/Text";

let mockLanguage = "ar";
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

describe("keepNumberLtr", () => {
  it("keeps numbers, amounts and signed values left to right", () => {
    for (const text of ["-2", "+3", "21.00 DH", "+0.80 DH · 53.3%", "6111000000012", "09:35"]) {
      expect(keepNumberLtr(text)).toBe(isolateLtr(text));
    }
  });

  it("leaves words and text holding Arabic alone", () => {
    for (const text of ["Coca-Cola 33cl", "مخزون", "46 قطعة", "DH", ""]) {
      expect(keepNumberLtr(text)).toBe(text);
    }
  });

  it("does not wrap text that is already isolated", () => {
    expect(keepNumberLtr(isolateLtr("21.00 DH"))).toBe(isolateLtr("21.00 DH"));
  });
});

describe("Text", () => {
  const shown = (node: React.ReactElement) => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(node);
    });
    return tree.root.findByType(RNText).props.children;
  };

  beforeEach(() => {
    mockLanguage = "ar";
  });

  it("joins a sign and a quantity into one left-to-right run in Arabic", () => {
    expect(
      shown(
        <Text>
          {"+"}
          {3}
        </Text>
      )
    ).toBe(isolateLtr("+3"));
    expect(
      shown(
        <Text>
          {""}
          {-2}
        </Text>
      )
    ).toBe(isolateLtr("-2"));
  });

  it("changes nothing in French", () => {
    mockLanguage = "fr";
    expect(shown(<Text>21.00 DH</Text>)).toBe("21.00 DH");
  });

  it("leaves nested elements alone", () => {
    const nested = <Text>a</Text>;
    expect(shown(<Text>{nested}</Text>)).toBe(nested);
  });
});
