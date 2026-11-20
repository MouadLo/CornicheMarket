import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import DayScreen from "../../app/(app)/sell/day";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

const mockFetch = jest.fn();
jest.mock("@/src/lib/day/queries", () => ({
  fetchDaySummary: (...args: unknown[]) => mockFetch(...args),
  closeDay: jest.fn(),
  reopenDay: jest.fn(),
}));
jest.mock("@/src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "owner" } }),
}));
jest.mock("react-i18next", () => {
  const t = (key: string, o?: { count?: number }) =>
    o?.count !== undefined ? `${key}:${o.count}` : key;
  const value = { t, i18n: { language: "fr" } };
  return { useTranslation: () => value };
});
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

const summary = {
  day: "2026-11-18",
  today: "2026-11-18",
  closed: false,
  close: null,
  suggested_float_cents: 0,
  cashiers: [],
};

let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined as never;
  mockFetch.mockReset();
});

async function mount() {
  await act(async () => {
    tree = create(<DayScreen />);
  });
}

describe("Sales Day screen, failed load", () => {
  it("shows a load error with Retry, never a day with no activity", async () => {
    mockFetch.mockRejectedValue(new Error("Failed to fetch"));
    await mount();
    const texts = allTexts(tree.root);
    expect(texts).toEqual(expect.arrayContaining(["day.loadError", "common.retry"]));
    expect(texts).not.toContain("day.noActivity");
    expect(texts.join(" ")).not.toContain("day.title");
  });

  it("never shows the server's own text", async () => {
    mockFetch.mockRejectedValue(new Error('duplicate key value violates unique constraint "x"'));
    await mount();
    expect(allTexts(tree.root).join(" ")).not.toContain("duplicate key");
    expect(allTexts(tree.root)).toContain("day.loadError");
  });

  it("Retry asks for the same day again and shows the day when it works", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(summary);
    await mount();
    expect(mockFetch).toHaveBeenLastCalledWith(null);
    await act(async () => pressableByText(tree.root, "common.retry").props.onPress());
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(null);
    const texts = allTexts(tree.root);
    expect(texts).toContain("day.noActivity");
    expect(texts).not.toContain("day.loadError");
  });

  it("a day that loaded with no sales still says so", async () => {
    mockFetch.mockResolvedValue(summary);
    await mount();
    expect(allTexts(tree.root)).toContain("day.noActivity");
  });
});

describe("Sales Day screen, returns", () => {
  const row = {
    cashier_id: "c1",
    cashier_name: "Sara",
    sales_count: 3,
    cash_cents: 3000,
    card_cents: 1000,
    credit_cents: 0,
    discount_cents: 0,
    voids_count: 0,
    voids_cents: 0,
    cash_payments_cents: 500,
    card_payments_cents: 0,
    refunds_count: 2,
    cash_refunds_cents: 886,
    card_refunds_cents: 200,
    credit_refunds_cents: 0,
  };

  it("shows a Returns line and takes cash refunds off what the cashier hands over", async () => {
    mockFetch.mockResolvedValue({ ...summary, cashiers: [row] });
    await mount();
    const texts = allTexts(tree.root);
    expect(texts).toContain("day.refunds:2");
    expect(texts).toContain("⁦−10.86 DH⁩");
    // Cash 30.00 - 8.86 refunded, card 10.00 - 2.00 refunded.
    expect(texts).toContain("21.14 DH");
    expect(texts).toContain("8.00 DH");
    // Hand over: 30.00 + 5.00 repayments - 8.86 = 26.14.
    expect(texts).toContain("26.14 DH");
  });

  it("shows no Returns line on a day without returns", async () => {
    mockFetch.mockResolvedValue({
      ...summary,
      cashiers: [{ ...row, refunds_count: 0, cash_refunds_cents: 0, card_refunds_cents: 0 }],
    });
    await mount();
    expect(allTexts(tree.root).join("|")).not.toContain("day.refunds");
  });
});
