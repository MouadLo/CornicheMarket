/**
 * Loyalty on a product: the exclusion switch, bonus points per unit with an
 * optional last day (stored as the end of that store day), and the list badges.
 */
import React from "react";
import { Switch, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import { ProductForm } from "../../src/components/products/ProductForm";
import { ProductRow } from "../../src/components/products/ProductRow";
import { DateField } from "../../src/components/ui/DateField";
import type { Product } from "../../src/lib/products/queries";
import { allTexts } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: object) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "fr" },
  }),
}));
jest.mock("lucide-react-native", () => {
  const R = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => R.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/sales/queries", () => ({
  fetchDiscountLimits: async () => ({ percent: 5, maxCents: 2000 }),
}));
jest.mock("../../src/lib/reports/queries", () => ({ fetchStoreTimezone: async () => "UTC" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../../src/components/products/BarcodeScannerModal", () => ({
  BarcodeScannerModal: () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  createCategory: jest.fn(),
  findByBarcode: jest.fn(async () => null),
}));
jest.mock("../../src/lib/dialog/store", () => ({ confirm: jest.fn(), showToast: jest.fn() }));

const NOW = new Date("2026-11-20T12:00:00.000Z");
const base = {
  id: "p1",
  name: "Lait",
  barcode: null,
  category_id: null,
  unit: "piece",
  selling_price_cents: 800,
  current_cost_cents: 600,
  stock_quantity: 3,
  low_stock_threshold: 0,
  is_low_stock: false,
  active: true,
} as unknown as Product;

const onSubmit = jest.fn(async (..._a: unknown[]) => {});
let tree: ReactTestRenderer;

const render = async (initial: Product = base) => {
  await act(async () => {
    tree = create(
      <ProductForm categories={[]} initial={initial} submitLabel="save" onSubmit={onSubmit} />
    );
  });
};
const excludedSwitch = () =>
  tree.root
    .findAllByType(Switch)
    .find((n) => n.props.accessibilityLabel === "loyalty.productExcluded")!;
const bonusInput = () =>
  tree.root
    .findAllByType(TextInput)
    .find((n) => n.props.accessibilityLabel === "loyalty.productBonusLabel")!;
const dateField = () =>
  tree.root.findAllByType(DateField).find((n) => n.props.label === "loyalty.productBonusUntil")!;
const save = () =>
  act(async () => {
    await tree.root
      .findAllByType(BigButton)
      .find((b) => b.props.label === "save")!
      .props.onPress();
  });
const submitted = () => onSubmit.mock.calls[0][0] as Record<string, unknown>;

beforeEach(() => {
  jest
    .useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] })
    .setSystemTime(NOW);
  onSubmit.mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.useRealTimers();
});

describe("product form: loyalty", () => {
  it("saves a normal product as not excluded, with no bonus and no end", async () => {
    await render();
    await save();
    expect(submitted()).toMatchObject({
      loyalty_excluded: false,
      loyalty_bonus_points: 0,
      loyalty_bonus_until: null,
    });
  });

  it("disables the bonus field with a hint when the product is excluded", async () => {
    await render();
    expect(bonusInput().props.editable).toBe(true);
    expect(allTexts(tree.root)).toContain("loyalty.productBonusHint");
    act(() => excludedSwitch().props.onValueChange(true));
    expect(bonusInput().props.editable).toBe(false);
    expect(dateField().props.disabled).toBe(true);
    expect(allTexts(tree.root)).toContain("loyalty.productBonusDisabled");
    await save();
    expect(submitted().loyalty_excluded).toBe(true);
  });

  it("stores bonus points and the end of the chosen store day", async () => {
    await render();
    act(() => bonusInput().props.onChangeText("20"));
    act(() => dateField().props.onChange("2026-12-31"));
    await save();
    expect(submitted()).toMatchObject({
      loyalty_bonus_points: 20,
      loyalty_bonus_until: "2027-01-01T00:00:00.000Z",
    });
  });

  it("a bonus without an end date has no end", async () => {
    await render();
    act(() => bonusInput().props.onChangeText("5"));
    await save();
    expect(submitted()).toMatchObject({ loyalty_bonus_points: 5, loyalty_bonus_until: null });
  });

  it("refuses bonus points that are not a whole number up to 10000", async () => {
    await render();
    for (const bad of ["abc", "10001", "-3", "2.5"]) {
      onSubmit.mockClear();
      act(() => bonusInput().props.onChangeText(bad));
      await save();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(allTexts(tree.root).join("|")).toContain("loyalty.errBonusPoints");
    }
  });

  it("refuses an end date in the past", async () => {
    await render();
    act(() => bonusInput().props.onChangeText("20"));
    act(() => dateField().props.onChange("2026-11-01"));
    await save();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(allTexts(tree.root).join("|")).toContain("loyalty.errBonusUntilPast");
  });

  it("shows the saved bonus and its last day, and an ended promo does not block other edits", async () => {
    await render({
      ...base,
      loyalty_bonus_points: 15,
      loyalty_bonus_until: "2026-11-10T00:00:00.000Z",
    });
    expect(bonusInput().props.value).toBe("15");
    expect(dateField().props.value).toBe("2026-11-09");
    await save();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitted()).toMatchObject({
      loyalty_bonus_points: 15,
      loyalty_bonus_until: "2026-11-10T00:00:00.000Z",
    });
  });

  it("clearing the bonus points drops the end date", async () => {
    await render({
      ...base,
      loyalty_bonus_points: 15,
      loyalty_bonus_until: "2027-03-10T00:00:00.000Z",
    });
    act(() => bonusInput().props.onChangeText(""));
    await save();
    expect(submitted()).toMatchObject({ loyalty_bonus_points: 0, loyalty_bonus_until: null });
  });
});

describe("product row badges", () => {
  const renderRow = (extra: Partial<Product>, showCost = false) => {
    act(() => {
      tree = create(<ProductRow product={{ ...base, ...extra } as Product} showCost={showCost} />);
    });
    return allTexts(tree.root).join("|");
  };

  it("shows '+20 pts' while a bonus runs, to a cashier too", () => {
    expect(renderRow({ loyalty_bonus_points: 20 })).toContain('loyalty.rowBonus{"points":"⁦20⁩"}');
  });

  it("shows Excluded, and no bonus badge, for an excluded product", () => {
    const texts = renderRow({ loyalty_excluded: true, loyalty_bonus_points: 20 });
    expect(texts).toContain("loyalty.rowExcluded");
    expect(texts).not.toContain("loyalty.rowBonus");
  });

  it("shows nothing for a normal product or an ended promo", () => {
    expect(renderRow({})).not.toContain("loyalty.row");
    act(() => tree.unmount());
    expect(
      renderRow({ loyalty_bonus_points: 20, loyalty_bonus_until: "2026-11-01T00:00:00.000Z" })
    ).not.toContain("loyalty.row");
  });
});
