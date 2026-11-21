/**
 * The public card page: balance as DH first then points, the QR of its own
 * address, history, a friendly message for an unknown card, right to left in
 * Arabic, and it never needs a session.
 */
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Path } from "react-native-svg";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import CardPage from "../../app/card/[token]";
import { qrMatrix, qrPath } from "../../src/components/loyalty/CardQr";
import { cardUrl } from "../../src/lib/loyalty/card";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
let mockLanguage = "fr";
const mockFetchCard = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ token: "AbCdEfGhIjKlMnOpQrStUv" }),
}));
jest.mock("react-i18next", () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key);
  return {
    useTranslation: () => ({ t, i18n: { language: mockLanguage } }),
  };
});
jest.mock("../../src/lib/loyalty/queries", () => ({
  fetchPublicCard: (...a: unknown[]) => mockFetchCard(...a),
}));
jest.mock("../../src/lib/loyalty/origin", () => ({ appOrigin: () => "https://shop.example" }));
jest.mock("lucide-react-native", () => {
  const R = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => R.createElement("Icon", { name, ...p }) }
  );
});

const card = {
  firstName: "Amina",
  balancePoints: 34,
  balanceValueCents: 340,
  pointValueCents: 10,
  centsPerPoint: 1000,
  history: [
    { createdAt: "2026-11-02T10:00:00Z", kind: "earn", points: 12 },
    { createdAt: "2026-11-01T10:00:00Z", kind: "redeem", points: -50 },
  ],
};

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<CardPage />);
  });
};
const joined = () => allTexts(tree.root).join("|");

beforeEach(() => {
  mockLanguage = "fr";
  mockFetchCard.mockReset();
  mockFetchCard.mockResolvedValue(card);
});
afterEach(() => act(() => tree?.unmount()));

it("renders for a signed-out visitor: shop, first name, DH value then points, caption", async () => {
  await render();
  expect(mockFetchCard).toHaveBeenCalledWith(TOKEN);
  expect(joined()).toContain("Corniche Market");
  expect(joined()).toContain("loyalty.cardHello");
  expect(joined()).toContain("Amina");
  const texts = allTexts(tree.root);
  const valueIndex = texts.findIndex((x) => x.includes("3.40 DH"));
  const pointsIndex = texts.findIndex((x) => x.includes("loyalty.pointsMany"));
  expect(valueIndex).toBeGreaterThan(-1);
  expect(pointsIndex).toBeGreaterThan(valueIndex);
  expect(texts).toContain("loyalty.cardShowAtCounter");
});

it("the QR encodes the card's own address", async () => {
  await render();
  const expected = qrPath(qrMatrix(cardUrl("https://shop.example", TOKEN)), 4);
  expect(tree.root.findByType(Path).props.d).toBe(expected);
});

it("lists the recent history with a label and a signed amount per entry", async () => {
  await render();
  expect(joined()).toContain("loyalty.kindEarn");
  expect(joined()).toContain("loyalty.kindRedeem");
  expect(joined()).toContain("⁦+12⁩");
  expect(joined()).toContain("⁦−50⁩");
});

it("explains how points are earned with the rate the card carries, signed out", async () => {
  await render();
  const how = allTexts(tree.root).find((x) => x.startsWith("loyalty.cardHow{"));
  expect(how).toContain("10.00 DH");
});

it("follows the shop's own rate for every visitor (it comes with the card)", async () => {
  mockFetchCard.mockResolvedValue({ ...card, centsPerPoint: 1500 });
  await render();
  const how = allTexts(tree.root).find((x) => x.startsWith("loyalty.cardHow{"));
  expect(how).toContain("15.00 DH");
  expect(joined()).toContain("3.40 DH");
});

it("has no first name line when the card has none", async () => {
  mockFetchCard.mockResolvedValue({ ...card, firstName: null });
  await render();
  expect(joined()).not.toContain("loyalty.cardHello");
});

it("shows a friendly message for an unknown or replaced card, and no balance or QR", async () => {
  mockFetchCard.mockResolvedValue(null);
  await render();
  expect(joined()).toContain("loyalty.cardUnknownTitle");
  expect(joined()).toContain("loyalty.cardUnknownMessage");
  expect(joined()).not.toContain("DH");
  expect(tree.root.findAllByType(Path)).toHaveLength(0);
});

it("a failed read says so and can be retried", async () => {
  mockFetchCard.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await render();
  expect(joined()).toContain("loyalty.cardErrorTitle");
  await act(async () => {
    await pressableByText(tree.root, "common.retry").props.onPress();
  });
  expect(mockFetchCard).toHaveBeenCalledTimes(2);
  expect(joined()).toContain("3.40 DH");
});

it("is right to left in Arabic and left to right in French", async () => {
  mockLanguage = "ar";
  await render();
  const direction = () =>
    StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).direction;
  expect(direction()).toBe("rtl");
  act(() => tree.unmount());
  mockLanguage = "fr";
  await render();
  expect(direction()).toBe("ltr");
});
