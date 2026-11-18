/**
 * Stock home (O6): large cards to every stock tool, count badges that load
 * independently and refresh on focus, and an owner-only gate.
 */
import React from "react";
import { Pressable } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import StockHome from "../../app/(app)/stock-in/index";
import { Badge } from "../../src/components/ui/Badge";

const mockPush = jest.fn();
const mockLow = jest.fn();
const mockExpiring = jest.fn();
const mockNegative = jest.fn();
let mockRole: "owner" | "cashier" = "owner";

jest.mock("expo-router", () => {
  const React = require("react");
  return {
    router: { push: (...a: unknown[]) => mockPush(...a) },
    useFocusEffect: (cb: () => void) => {
      React.useEffect(cb, [cb]);
    },
  };
});
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o?.days ? `${key}:${o.days}` : key),
    i18n: { language: "fr" },
  }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u-1", role: mockRole } }),
}));
jest.mock("../../src/lib/inventory/queries", () => ({
  fetchLowStockProducts: (...a: unknown[]) => mockLow(...a),
  fetchExpiringBatches: (...a: unknown[]) => mockExpiring(...a),
  fetchNegativeStockProducts: (...a: unknown[]) => mockNegative(...a),
}));

let tree: ReactTestRenderer;
const mount = async () => {
  await act(async () => {
    tree = create(<StockHome />);
  });
};
const cards = () => tree.root.findAllByType(Pressable);
const card = (label: string) =>
  cards().find((c) => String(c.props.accessibilityLabel).startsWith(label))!;
const badges = () => tree.root.findAllByType(Badge).map((b) => [b.props.value, b.props.tone]);

beforeEach(() => {
  mockRole = "owner";
  [mockPush, mockLow, mockExpiring, mockNegative].forEach((m) => m.mockReset());
  mockLow.mockResolvedValue([1, 2, 3]);
  mockExpiring.mockResolvedValue([1]);
  mockNegative.mockResolvedValue([]);
});
afterEach(() => act(() => tree.unmount()));

describe("Stock home", () => {
  it("shows a card for every tool and opens the right route", async () => {
    await mount();
    expect(cards()).toHaveLength(9);
    act(() => card("stockIn.home.receive").props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/stock-in/receive");
    act(() => card("stockIn.home.negativeStock").props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/(app)/stock-in/negative-stock");
  });

  it("badges: attention colour above zero, calm zero, same query definitions as the screens", async () => {
    await mount();
    expect(badges()).toEqual([
      [3, "warn"],
      [1, "warn"],
      [0, "ok"],
    ]);
    expect(mockLow).toHaveBeenCalledWith(true);
    expect(mockExpiring).toHaveBeenCalledWith(30);
  });

  it("a failing count shows no badge, never a false 0, and the others still show", async () => {
    mockExpiring.mockRejectedValue(new Error("offline"));
    await mount();
    expect(badges()).toEqual([
      [3, "warn"],
      [0, "ok"],
    ]);
  });

  it("blocks cashiers without loading anything", async () => {
    mockRole = "cashier";
    await mount();
    expect(cards()).toHaveLength(0);
    expect(mockLow).not.toHaveBeenCalled();
  });
});
