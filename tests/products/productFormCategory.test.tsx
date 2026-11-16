import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import { ProductForm } from "../../src/components/products/ProductForm";
import { createCategory } from "../../src/lib/products/queries";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../../src/components/products/BarcodeScannerModal", () => ({
  BarcodeScannerModal: () => null,
}));
jest.mock("../../src/lib/products/queries", () => ({
  createCategory: jest.fn(),
  findByBarcode: jest.fn(async () => null),
}));

const categories = [
  { id: "c1", name: "Boissons" },
  { id: "c2", name: "Épicerie" },
];
const onSubmit = jest.fn(async () => {});

let tree: ReactTestRenderer;
const render = async (loaded = categories) => {
  await act(async () => {
    tree = create(<ProductForm categories={loaded} submitLabel="save" onSubmit={onSubmit} />);
  });
};

const textIn = (node: {
  findAllByType: (type: typeof Text) => { props: { children?: unknown } }[];
}) =>
  node
    .findAllByType(Text)
    .map((text) => [text.props.children].flat(Infinity).join(""))
    .join("");
const chip = (label: string) =>
  tree.root.findAllByType(Pressable).find((node) => textIn(node) === label);
const press = (label: string) => act(() => chip(label)!.props.onPress());
const selected = (label: string) => {
  const style = ([] as unknown[]).concat(chip(label)!.props.style).flat(Infinity);
  return style.some(
    (entry) => (entry as { backgroundColor?: string })?.backgroundColor === "#0b5266"
  );
};
const categoryInput = () =>
  tree.root
    .findAllByType(TextInput)
    .find((input) => input.props.accessibilityLabel === "products.formCategoryName")!;
const button = (label: string) =>
  tree.root.findAllByType(BigButton).find((node) => node.props.label === label)!;
const type = (text: string) => act(() => categoryInput().props.onChangeText(text));
const add = () =>
  act(async () => {
    await button("products.formCategoryAdd").props.onPress();
  });
const has = (text: string) =>
  tree.root
    .findAllByType(Text)
    .some((node) => [node.props.children].flat(Infinity).join("").includes(text));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createCategory).mockImplementation(async (name: string) => ({ id: "new-id", name }));
});
afterEach(() => act(() => tree?.unmount()));

it("offers a New category chip that opens a name field", async () => {
  await render();
  expect(chip("products.formNewCategory")).toBeDefined();
  expect(
    tree.root
      .findAllByType(TextInput)
      .some((i) => i.props.accessibilityLabel === "products.formCategoryName")
  ).toBe(false);
  press("products.formNewCategory");
  expect(categoryInput()).toBeDefined();
  expect(button("products.formCategoryAdd").props.disabled).toBe(true);
});

it("creates the category with a tidy name, adds it to the chips, and selects it", async () => {
  await render();
  press("products.formNewCategory");
  type("  Produits   ménagers ");
  await add();

  expect(createCategory).toHaveBeenCalledWith("Produits ménagers");
  expect(chip("Produits ménagers")).toBeDefined();
  expect(selected("Produits ménagers")).toBe(true);
  // The field closes.
  expect(
    tree.root
      .findAllByType(TextInput)
      .some((i) => i.props.accessibilityLabel === "products.formCategoryName")
  ).toBe(false);
});

it("saves the product with the new category", async () => {
  await render();
  act(() => tree.root.findAllByType(TextInput)[0].props.onChangeText("Savon"));
  act(() =>
    tree.root
      .findAllByType(TextInput)
      .find((i) => i.props.placeholder === "0.00")!
      .props.onChangeText("12")
  );
  press("products.formNewCategory");
  type("Hygiène");
  await add();
  await act(async () => {
    await button("save").props.onPress();
  });
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Savon", category_id: "new-id" })
  );
});

it("uses the existing category instead of creating a twin, whatever the case or accents", async () => {
  await render();
  press("products.formNewCategory");
  type("epicerie");
  await add();
  expect(createCategory).not.toHaveBeenCalled();
  expect(selected("Épicerie")).toBe(true);
});

it("refuses a name that is too long, without calling the server", async () => {
  await render();
  press("products.formNewCategory");
  type("x".repeat(80));
  await add();
  expect(createCategory).not.toHaveBeenCalled();
  expect(has("products.formCategoryInvalid")).toBe(true);
});

it("shows an error and selects nothing when creating fails", async () => {
  jest.mocked(createCategory).mockRejectedValueOnce(new Error("permission denied"));
  await render();
  press("products.formNewCategory");
  type("Snacks");
  await add();
  expect(has("products.formCategoryError")).toBe(true);
  expect(chip("Snacks")).toBeUndefined();
  // The owner can correct and try again.
  await add();
  expect(createCategory).toHaveBeenCalledTimes(2);
  expect(selected("Snacks")).toBe(true);
});

it("cancel closes the field and creates nothing", async () => {
  await render();
  press("products.formNewCategory");
  type("Snacks");
  act(() => button("common.cancel").props.onPress());
  expect(createCategory).not.toHaveBeenCalled();
  expect(
    tree.root
      .findAllByType(TextInput)
      .some((i) => i.props.accessibilityLabel === "products.formCategoryName")
  ).toBe(false);
});

it("keeps a category created here when the loaded list arrives or changes afterwards", async () => {
  await render([]);
  press("products.formNewCategory");
  type("Snacks");
  await add();
  await act(async () => {
    tree.update(<ProductForm categories={categories} submitLabel="save" onSubmit={onSubmit} />);
  });
  expect(chip("Snacks")).toBeDefined();
  expect(chip("Boissons")).toBeDefined();
  expect(selected("Snacks")).toBe(true);
});
