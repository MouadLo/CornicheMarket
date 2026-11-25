import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { RecentPriceChangesPanel } from "../../src/components/products/RecentPriceChangesPanel";
import { confirm, showToast } from "../../src/lib/dialog/store";
import { fetchRecentPriceChanges, undoPriceChange } from "../../src/lib/products/queries";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => {
  const t = (key: string, values?: object) => key + (values ? JSON.stringify(values) : "");
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
jest.mock("../../src/lib/dialog/store", () => ({ confirm: jest.fn(), showToast: jest.fn() }));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/products/queries", () => ({
  fetchRecentPriceChanges: jest.fn(),
  undoPriceChange: jest.fn(),
}));

const live = {
  id: "b1",
  created_at: "2026-11-20T10:00:00Z",
  category_id: "c1",
  percent: -10,
  product_count: 4,
  reverted_at: null,
};
const undone = {
  ...live,
  id: "b2",
  category_id: null,
  percent: 5,
  product_count: 7,
  reverted_at: "2026-11-20T11:00:00Z",
};

let tree: ReactTestRenderer;
const onUndone = jest.fn();
const render = async () => {
  await act(async () => {
    tree = create(
      <RecentPriceChangesPanel
        visible
        categories={[{ id: "c1", name: "Boissons" } as never]}
        onClose={() => {}}
        onUndone={onUndone}
      />
    );
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchRecentPriceChanges).mockResolvedValue([live, undone]);
});
afterEach(() => act(() => tree.unmount()));

it("lists the recent changes with scope, percent, count and an undone tag", async () => {
  await render();
  expect(fetchRecentPriceChanges).toHaveBeenCalledWith(10);
  const shown = allTexts(tree.root).join("|");
  expect(shown).toContain("Boissons");
  expect(shown).toContain("products.bulkAll");
  expect(shown).toContain("⁦-10%⁩");
  expect(shown).toContain("⁦+5%⁩");
  expect(shown).toContain('"count":4');
  expect(allTexts(tree.root).filter((x) => x === "products.priceChangeReverted")).toHaveLength(1);
  // Only the change not yet undone offers the action.
  expect(allTexts(tree.root).filter((x) => x === "products.priceChangeUndo")).toHaveLength(1);
});

it("undoes a change after confirmation, refreshes the list and tells how many were skipped", async () => {
  jest.mocked(confirm).mockResolvedValue(true);
  jest.mocked(undoPriceChange).mockResolvedValue({ restored: 3, skipped: 1 });
  await render();
  await act(async () => {
    await pressableByText(tree.root, "products.priceChangeUndo").props.onPress();
  });
  expect(jest.mocked(confirm).mock.calls[0][0].message).toContain('"count":4');
  expect(undoPriceChange).toHaveBeenCalledWith("b1");
  expect(showToast).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'products.priceUndoDoneSkipped{"restored":3,"skipped":1}' })
  );
  expect(fetchRecentPriceChanges).toHaveBeenCalledTimes(2);
  expect(onUndone).toHaveBeenCalledTimes(1);
});

it("does nothing when the confirmation is declined", async () => {
  jest.mocked(confirm).mockResolvedValue(false);
  await render();
  await act(async () => {
    await pressableByText(tree.root, "products.priceChangeUndo").props.onPress();
  });
  expect(undoPriceChange).not.toHaveBeenCalled();
  expect(onUndone).not.toHaveBeenCalled();
});

it("shows a translated message and keeps the list when the undo fails", async () => {
  jest.mocked(confirm).mockResolvedValue(true);
  jest.mocked(undoPriceChange).mockRejectedValue(new Error("boom"));
  await render();
  await act(async () => {
    await pressableByText(tree.root, "products.priceChangeUndo").props.onPress();
  });
  expect(jest.mocked(showToast).mock.calls[0][0].text).toBe("products.priceUndoError");
  expect(onUndone).not.toHaveBeenCalled();
});

it("says so when there is no change yet, and when the list cannot load", async () => {
  jest.mocked(fetchRecentPriceChanges).mockResolvedValueOnce([]);
  await render();
  expect(allTexts(tree.root)).toContain("products.priceChangesEmpty");
  await act(() => tree.unmount());

  jest.mocked(fetchRecentPriceChanges).mockRejectedValueOnce(new Error("x"));
  await render();
  expect(allTexts(tree.root)).toContain("products.priceChangesLoadError");
});

it("labels a batch applied from the competitor prices page, without a percent", async () => {
  jest
    .mocked(fetchRecentPriceChanges)
    .mockResolvedValue([{ ...live, id: "b3", source: "competitor", percent: 0, product_count: 2 }]);
  await render();
  const shown = allTexts(tree.root).join("|");
  expect(shown).toContain("products.priceChangeCompetitor");
  expect(shown).toContain('products.priceChangeLineCompetitor{"count":2}');
  expect(shown).not.toContain("products.priceChangeLine{");
});

it("labels a batch made by linking a web product, without a percent", async () => {
  jest
    .mocked(fetchRecentPriceChanges)
    .mockResolvedValue([{ ...live, id: "b4", source: "webstore", percent: 0, product_count: 1 }]);
  await render();
  const shown = allTexts(tree.root).join("|");
  expect(shown).toContain("products.priceChangeWebstore");
  expect(shown).not.toContain("products.priceChangeLine{");
});
