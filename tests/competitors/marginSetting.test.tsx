import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { CompetitorMarginSection } from "../../src/components/settings/CompetitorMarginSection";
import { fetchStoreMinMargin, updateStoreMinMargin } from "../../src/lib/competitors/queries";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => {
  const t = (key: string) => key;
  const value = { t, i18n: { language: "fr" } };
  return { useTranslation: () => value };
});
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/competitors/queries", () => ({
  fetchStoreMinMargin: jest.fn(),
  updateStoreMinMargin: jest.fn(),
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<CompetitorMarginSection />);
  });
};
const field = () =>
  tree.root.find(
    (n) =>
      n.props.accessibilityLabel === "settings.competitorMarginLabel" &&
      typeof n.props.onChangeText === "function"
  );
const save = async () => {
  await act(async () => {
    await pressableByText(tree.root, "settings.competitorMarginSave").props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchStoreMinMargin).mockResolvedValue(15);
});
afterEach(() => act(() => tree.unmount()));

it("shows the current store margin (15 by default) and saves a new one", async () => {
  await render();
  expect(field().props.value).toBe("15");
  await act(async () => field().props.onChangeText("12,5"));
  await save();
  expect(updateStoreMinMargin).toHaveBeenCalledWith(12.5);
  expect(allTexts(tree.root)).toContain("settings.competitorMarginSaved");
});

it("refuses a value above 95 or text", async () => {
  await render();
  for (const bad of ["96", "abc", ""]) {
    await act(async () => field().props.onChangeText(bad));
    await save();
  }
  expect(updateStoreMinMargin).not.toHaveBeenCalled();
  expect(allTexts(tree.root)).toContain("settings.competitorMarginErr");
});

it("a failed read offers a retry instead of the form", async () => {
  jest.mocked(fetchStoreMinMargin).mockRejectedValueOnce(new Error("x"));
  await render();
  expect(allTexts(tree.root)).toContain("settings.competitorMarginLoadError");
  await act(async () => {
    pressableByText(tree.root, "common.retry").props.onPress();
  });
  expect(field().props.value).toBe("15");
});
