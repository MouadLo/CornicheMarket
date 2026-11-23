import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { confirmMatch } from "../../src/lib/competitors/shops";
import { showToast } from "../../src/lib/dialog/store";
import {
  copyCompetitorPhoto,
  fetchCompetitorItemImageUrl,
  uploadProductPhoto,
} from "../../src/lib/products/photos";
import { createProduct } from "../../src/lib/products/queries";

import NewProduct from "../../app/(app)/products/new";

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
let mockFormProps: {
  header: React.ReactElement;
  onSubmit: (input: object, tile: null) => Promise<void>;
};

let mockStackIndex = 1;
jest.mock("expo-router", () => ({
  useNavigation: () => ({ getState: () => ({ index: mockStackIndex }) }),
  usePathname: () => "/products/new",
  router: { back: () => mockBack(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "fr" } }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u", role: "owner" } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/dialog/store", () => ({ showToast: jest.fn(), confirm: jest.fn() }));
jest.mock("../../src/lib/competitors/shops", () => ({ confirmMatch: jest.fn() }));
jest.mock("../../src/lib/products/useUnsavedGuard", () => ({ useUnsavedGuard: () => jest.fn() }));
jest.mock("../../src/lib/products/queries", () => ({
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  fetchCategories: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../src/lib/products/photos", () => ({
  copyCompetitorPhoto: jest.fn(),
  fetchCompetitorItemImageUrl: jest.fn(),
  uploadProductPhoto: jest.fn(),
}));
jest.mock("../../src/components/products/ProductPhotoSection", () => ({
  ProductPhotoSection: () => null,
}));
jest.mock("../../src/lib/sellGrid/queries", () => ({ saveProductTileSettings: jest.fn() }));
jest.mock("../../src/lib/sellGrid/refresh", () => ({ refreshGridCache: jest.fn() }));
jest.mock("../../src/components/products/ProductForm", () => ({
  ProductForm: (props: typeof mockFormProps) => {
    mockFormProps = props;
    return null;
  },
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<NewProduct />);
  });
};
const submit = () =>
  act(async () => {
    await mockFormProps.onSubmit({}, null);
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.mocked(createProduct).mockResolvedValue("new-product");
  jest.mocked(confirmMatch).mockResolvedValue("link");
  jest.mocked(fetchCompetitorItemImageUrl).mockResolvedValue("https://shop/a.jpg");
  jest.mocked(copyCompetitorPhoto).mockResolvedValue("saved");
  jest.mocked(uploadProductPhoto).mockResolvedValue("new-product/x.jpg");
});
afterEach(() => act(() => tree.unmount()));

it("from À sourcer, the competitor photo is attached after the product is saved and linked", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  const order: string[] = [];
  jest.mocked(confirmMatch).mockImplementation(async () => (order.push("link"), "link"));
  jest.mocked(copyCompetitorPhoto).mockImplementation(async () => (order.push("photo"), "saved"));
  await render();
  await submit();
  expect(fetchCompetitorItemImageUrl).toHaveBeenCalledWith("item-1");
  expect(copyCompetitorPhoto).toHaveBeenCalledWith("https://shop/a.jpg", "new-product");
  expect(order).toEqual(["link", "photo"]);
  expect(mockBack).toHaveBeenCalled();
});

it("a photo that cannot be attached keeps the product and shows an info toast", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  jest.mocked(copyCompetitorPhoto).mockResolvedValue("refused");
  await render();
  await submit();
  expect(createProduct).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith({ text: "products.photo.attachFailed", tone: "info" });
  expect(mockBack).toHaveBeenCalled();
});

it("a thrown photo error never breaks saving", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  jest.mocked(copyCompetitorPhoto).mockRejectedValue(new Error("boom"));
  await render();
  await submit();
  expect(mockBack).toHaveBeenCalled();
});

it("an item without a photo attaches nothing", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  jest.mocked(fetchCompetitorItemImageUrl).mockResolvedValue(null);
  await render();
  await submit();
  expect(copyCompetitorPhoto).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalledWith(
    expect.objectContaining({ text: "products.photo.attachFailed" })
  );
});

it("a photo the owner picked on the form wins over the competitor's", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  await render();
  const section = mockFormProps.header as React.ReactElement<{
    onPendingChange: (p: { base64: string } | null) => void;
  }>;
  act(() => section.props.onPendingChange({ base64: "AA==" }));
  await submit();
  expect(uploadProductPhoto).toHaveBeenCalledWith("new-product", { base64: "AA==" });
  expect(copyCompetitorPhoto).not.toHaveBeenCalled();
});

it("without a competitor item and without a picked photo, no photo work happens", async () => {
  await render();
  await submit();
  expect(uploadProductPhoto).not.toHaveBeenCalled();
  expect(copyCompetitorPhoto).not.toHaveBeenCalled();
});

it("from À sourcer, the competitor's photo is passed to the form as a preview", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  await render();
  const section = mockFormProps.header as React.ReactElement<{ suggestedUrl: string | null }>;
  expect(section.props.suggestedUrl).toBe("https://shop/a.jpg");
});

it("without a competitor item there is no preview and no lookup", async () => {
  await render();
  const section = mockFormProps.header as React.ReactElement<{ suggestedUrl: string | null }>;
  expect(section.props.suggestedUrl).toBeNull();
  expect(fetchCompetitorItemImageUrl).not.toHaveBeenCalled();
});

it("if the owner removed the competitor's photo in the form, it is not copied on save", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  await render();
  const section = mockFormProps.header as React.ReactElement<{ onSuggestedRemoved: () => void }>;
  act(() => section.props.onSuggestedRemoved());
  await submit();
  expect(copyCompetitorPhoto).not.toHaveBeenCalled();
  expect(uploadProductPhoto).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalled();
});

it("the previewed photo is the one copied on save (no second lookup)", async () => {
  mockParams = { competitorItemId: "item-1", name: "X" };
  await render();
  expect(fetchCompetitorItemImageUrl).toHaveBeenCalledTimes(1);
  await submit();
  expect(fetchCompetitorItemImageUrl).toHaveBeenCalledTimes(1);
  expect(copyCompetitorPhoto).toHaveBeenCalledWith("https://shop/a.jpg", "new-product");
});
