// Settings > Divers (owner): the cashiers' maximum and the estimated margin.
import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import { DiversSection } from "../../src/components/settings/DiversSection";
import { allTexts } from "../sales/sellTestUtils";

const mockFetch = jest.fn();
const mockUpdate = jest.fn(async (..._a: unknown[]) => {});

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "fr" } }),
}));
jest.mock("../../src/lib/sellGrid/queries", () => ({
  fetchDiversSettings: () => mockFetch(),
  updateDiversSettings: (...a: unknown[]) => mockUpdate(...a),
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<DiversSection />);
  });
};
const field = (label: string) =>
  tree.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
const save = () =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === "settings.diversSave")!;

beforeEach(() => {
  mockFetch.mockReset();
  mockUpdate.mockClear();
  mockFetch.mockResolvedValue({ maxCents: 20000, marginPercent: 20 });
});
afterEach(() => act(() => tree.unmount()));

it("shows the saved values: 200.00 DH and 20 %", async () => {
  await render();
  expect(field("settings.diversMaxLabel").props.value).toBe("200.00");
  expect(field("settings.diversMarginLabel").props.value).toBe("20");
});

it("saves the maximum in centimes and the margin, then confirms", async () => {
  await render();
  act(() => field("settings.diversMaxLabel").props.onChangeText("350,5"));
  act(() => field("settings.diversMarginLabel").props.onChangeText("15"));
  await act(async () => save().props.onPress());
  expect(mockUpdate).toHaveBeenCalledWith({ maxCents: 35050, marginPercent: 15 });
  expect(allTexts(tree.root)).toContain("settings.diversSaved");
});

it("refuses a zero maximum and a margin over 95, and saves nothing", async () => {
  await render();
  act(() => field("settings.diversMaxLabel").props.onChangeText("0"));
  act(() => field("settings.diversMarginLabel").props.onChangeText("96"));
  await act(async () => save().props.onPress());
  const texts = allTexts(tree.root);
  expect(texts).toContain("settings.diversErrMax");
  expect(texts).toContain("settings.diversErrMargin");
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("says so when saving fails", async () => {
  mockUpdate.mockRejectedValueOnce(new Error("rls"));
  await render();
  await act(async () => save().props.onPress());
  expect(allTexts(tree.root).join("|")).toContain("settings.diversSaveError");
});

it("offers a retry when the settings cannot be read", async () => {
  mockFetch.mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(allTexts(tree.root).join("|")).toContain("settings.diversLoadError");
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});
