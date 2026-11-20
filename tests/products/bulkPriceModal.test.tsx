import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import { BulkPriceModal } from "../../src/components/products/BulkPriceModal";
import { confirm, showToast } from "../../src/lib/dialog/store";
import {
  bulkAdjustSellingPrice,
  fetchBulkPriceTargets,
  fetchRecentPriceChanges,
  undoPriceChange,
} from "../../src/lib/products/queries";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: object) => key + (values ? JSON.stringify(values) : ""),
  }),
}));
jest.mock("../../src/lib/dialog/store", () => ({ confirm: jest.fn(), showToast: jest.fn() }));
jest.mock("../../src/lib/products/queries", () => ({
  fetchBulkPriceTargets: jest.fn(),
  bulkAdjustSellingPrice: jest.fn(),
  fetchRecentPriceChanges: jest.fn(),
  undoPriceChange: jest.fn(),
}));

const batch = (id: string) => ({
  id,
  created_at: "2026-11-20T10:00:00Z",
  category_id: null,
  percent: 5,
  product_count: 3,
  reverted_at: null,
});

const target = (name: string, price: number, cost: number | null) =>
  ({ name, selling_price_cents: price, current_cost_cents: cost }) as never;

let tree: ReactTestRenderer;
const onApplied = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(fetchBulkPriceTargets)
    .mockResolvedValue([
      target("Coca-Cola 33cl", 700, 600),
      target("Baguette", 150, 80),
      target("Lait", 1200, 1100),
    ]);
  jest.mocked(bulkAdjustSellingPrice).mockResolvedValue(3);
  // Before the change the newest batch is "old"; after it, "new".
  jest.mocked(fetchRecentPriceChanges).mockReset();
  jest
    .mocked(fetchRecentPriceChanges)
    .mockResolvedValueOnce([batch("old")])
    .mockResolvedValue([batch("new")]);
});
afterEach(() => act(() => tree?.unmount()));

async function open() {
  await act(async () => {
    tree = create(
      <BulkPriceModal visible categories={[]} onClose={() => {}} onApplied={onApplied} />
    );
  });
}
const type = (text: string) =>
  act(() => {
    tree.root.findByType(TextInput).props.onChangeText(text);
  });
const apply = async () => {
  const button = tree.root.findAllByType(BigButton).find((b) => b.props.label === "common.apply")!;
  await act(async () => {
    await button.props.onPress();
  });
};
const applyButton = () =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === "common.apply")!;

it("asks first, with the real number of products and before/after prices, and sends nothing on No", async () => {
  jest.mocked(confirm).mockResolvedValue(false);
  await open();
  type("-20");
  await apply();

  expect(fetchBulkPriceTargets).toHaveBeenCalledWith(null, undefined);
  const options = jest.mocked(confirm).mock.calls[0][0];
  expect(options.tone).toBe("danger");
  expect(options.title).toContain('"count":3');
  expect(options.consequences).toEqual([
    { label: "Coca-Cola 33cl", before: "7.00 DH", after: "5.60 DH" },
    { label: "Baguette", before: "1.50 DH", after: "1.20 DH" },
    { label: "Lait", before: "12.00 DH", after: "9.60 DH" },
  ]);
  // -20% takes Coca-Cola (6.00 buy) below cost: 5.60; Lait (11.00 buy) 9.60 too; Baguette (0.80) stays above.
  expect(options.message).toContain('"count":2');
  expect(bulkAdjustSellingPrice).not.toHaveBeenCalled();
  expect(onApplied).not.toHaveBeenCalled();
});

it("applies the change only after the owner confirms, then reports how many prices changed", async () => {
  jest.mocked(confirm).mockResolvedValue(true);
  await open();
  type("5");
  await apply();

  expect(bulkAdjustSellingPrice).toHaveBeenCalledWith(null, 5);
  expect(showToast).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'products.bulkUpdated{"count":3}' })
  );
  expect(onApplied).toHaveBeenCalledTimes(1);
});

it.each(["0", "-100", "-150", "5000", "abc", ""])("will not apply %j", async (value) => {
  await open();
  type(value);
  expect(applyButton().props.disabled).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

it("tells the owner when nothing would change or nothing matches, without asking", async () => {
  await open();
  jest.mocked(fetchBulkPriceTargets).mockResolvedValueOnce([]);
  type("5");
  await apply();
  expect(JSON.stringify(tree.toJSON())).toContain("products.bulkNone");

  jest.mocked(fetchBulkPriceTargets).mockResolvedValueOnce([target("Tiny", 10, null)]);
  type("1");
  await apply();
  expect(JSON.stringify(tree.toJSON())).toContain("products.bulkNoChange");
  expect(confirm).not.toHaveBeenCalled();
  expect(bulkAdjustSellingPrice).not.toHaveBeenCalled();
});

it("shows a load failure instead of applying", async () => {
  jest.mocked(fetchBulkPriceTargets).mockRejectedValueOnce(new Error("network down"));
  await open();
  type("5");
  await apply();
  // Translated, and never the server's own text.
  expect(JSON.stringify(tree.toJSON())).toContain("products.bulkUpdateError");
  expect(JSON.stringify(tree.toJSON())).not.toContain("network down");
  expect(bulkAdjustSellingPrice).not.toHaveBeenCalled();
});

it("says plainly when the failure is the connection", async () => {
  jest.mocked(fetchBulkPriceTargets).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await open();
  type("5");
  await apply();
  expect(JSON.stringify(tree.toJSON())).toContain("errors.network");
  expect(JSON.stringify(tree.toJSON())).not.toContain("Failed to fetch");
});

describe("undo from the success toast", () => {
  const applyAndGetToast = async () => {
    jest.mocked(confirm).mockResolvedValueOnce(true);
    await open();
    type("5");
    await apply();
    return jest.mocked(showToast).mock.calls[0][0];
  };

  it("offers Undo, asks how many products go back, then undoes and refreshes", async () => {
    jest.mocked(undoPriceChange).mockResolvedValue({ restored: 3, skipped: 0 });
    const toast = await applyAndGetToast();
    expect(toast.action?.label).toBe("products.priceUndoAction");
    expect(undoPriceChange).not.toHaveBeenCalled();

    jest.mocked(confirm).mockResolvedValueOnce(true);
    await act(async () => {
      toast.action!.onPress();
    });
    const options = jest.mocked(confirm).mock.calls[1][0];
    expect(options.tone).toBe("danger");
    expect(options.message).toContain('"count":3');
    expect(undoPriceChange).toHaveBeenCalledWith("new");
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'products.priceUndoDone{"restored":3,"skipped":0}' })
    );
    expect(onApplied).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the owner declines the confirmation", async () => {
    const toast = await applyAndGetToast();
    jest.mocked(confirm).mockResolvedValueOnce(false);
    await act(async () => {
      toast.action!.onPress();
    });
    expect(undoPriceChange).not.toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("reports the skipped products in the result message", async () => {
    jest.mocked(undoPriceChange).mockResolvedValue({ restored: 2, skipped: 1 });
    const toast = await applyAndGetToast();
    jest.mocked(confirm).mockResolvedValueOnce(true);
    await act(async () => {
      toast.action!.onPress();
    });
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: 'products.priceUndoDoneSkipped{"restored":2,"skipped":1}',
      })
    );
  });

  it("offers no Undo when no new batch was recorded", async () => {
    jest.mocked(fetchRecentPriceChanges).mockReset();
    jest.mocked(fetchRecentPriceChanges).mockResolvedValue([batch("old")]);
    const toast = await applyAndGetToast();
    expect(toast.action).toBeUndefined();
  });
});
