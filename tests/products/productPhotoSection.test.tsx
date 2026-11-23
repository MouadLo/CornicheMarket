import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ProductPhotoSection } from "../../src/components/products/ProductPhotoSection";
import { confirmDestructive } from "../../src/lib/confirmDestructive";
import { pickProductPhoto } from "../../src/lib/products/photoPicker";
import { clearProductPhoto, uploadProductPhoto } from "../../src/lib/products/photos";
import { showToast } from "../../src/lib/dialog/store";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/dialog/store", () => ({ showToast: jest.fn(), confirm: jest.fn() }));
jest.mock("../../src/lib/confirmDestructive", () => ({ confirmDestructive: jest.fn() }));
jest.mock("../../src/lib/products/photoPicker", () => ({ pickProductPhoto: jest.fn() }));
jest.mock("../../src/lib/products/photos", () => ({
  uploadProductPhoto: jest.fn(),
  clearProductPhoto: jest.fn(),
}));
jest.mock("../../src/lib/products/photoUrls", () => ({ usePhotoUrl: () => null }));

let tree: ReactTestRenderer;
const buttons = () =>
  tree.root.findAll((n) => typeof n.props.label === "string" && !!n.props.onPress);
const labels = () => buttons().map((n) => n.props.label as string);
const press = async (label: string) => {
  const button = buttons().find((n) => n.props.label === label)!;
  await act(async () => {
    button.props.onPress();
  });
};
const render = async (props: Partial<React.ComponentProps<typeof ProductPhotoSection>> = {}) => {
  await act(async () => {
    tree = create(<ProductPhotoSection productId="p1" canEdit {...props} />);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(confirmDestructive).mockResolvedValue(true);
});
afterEach(() => act(() => tree.unmount()));

it("a cashier sees the photo area but no buttons", async () => {
  await render({ canEdit: false, initialPath: null });
  expect(labels()).toEqual([]);
  expect(JSON.stringify(tree.toJSON())).toContain("products.photo.none");
});

it("take a photo and choose an image call the picker with the right source and upload it", async () => {
  jest
    .mocked(pickProductPhoto)
    .mockResolvedValue({ prepared: { base64: "AA==" }, previewUri: "data:image/jpeg;base64,AA==" });
  jest.mocked(uploadProductPhoto).mockResolvedValue("p1/new.jpg");
  const onSaved = jest.fn();
  await render({ onSaved });
  await press("products.photo.take");
  expect(pickProductPhoto).toHaveBeenLastCalledWith("camera");
  await press("products.photo.choose");
  expect(pickProductPhoto).toHaveBeenLastCalledWith("library");
  expect(uploadProductPhoto).toHaveBeenCalledWith("p1", { base64: "AA==" });
  expect(onSaved).toHaveBeenCalledWith("p1/new.jpg");
});

it("a failed upload only shows a message", async () => {
  jest
    .mocked(pickProductPhoto)
    .mockResolvedValue({ prepared: { base64: "AA==" }, previewUri: "data:x" });
  jest.mocked(uploadProductPhoto).mockRejectedValue(new Error("boom"));
  await render();
  await press("products.photo.choose");
  expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ text: "products.photo.error" }));
});

it("a refused camera permission says so and uploads nothing", async () => {
  jest.mocked(pickProductPhoto).mockResolvedValue("denied");
  await render();
  await press("products.photo.take");
  expect(uploadProductPhoto).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith(
    expect.objectContaining({ text: "products.photo.cameraDenied" })
  );
});

it("remove only exists with a photo, asks first, and deletes only after yes", async () => {
  await render({ initialPath: null });
  expect(labels()).not.toContain("products.photo.remove");
  act(() => tree.unmount());

  await render({ initialPath: "p1/old.jpg" });
  jest.mocked(confirmDestructive).mockResolvedValueOnce(false);
  await press("products.photo.remove");
  expect(confirmDestructive).toHaveBeenCalledTimes(1);
  expect(clearProductPhoto).not.toHaveBeenCalled();

  await press("products.photo.remove");
  expect(clearProductPhoto).toHaveBeenCalledWith("p1");
  expect(labels()).not.toContain("products.photo.remove");
});

it("on a new product the photo is kept for later, not uploaded", async () => {
  jest
    .mocked(pickProductPhoto)
    .mockResolvedValue({ prepared: { base64: "AA==" }, previewUri: "data:image/jpeg;base64,AA==" });
  const onPendingChange = jest.fn();
  await render({ productId: null, onPendingChange });
  await press("products.photo.choose");
  expect(uploadProductPhoto).not.toHaveBeenCalled();
  expect(onPendingChange).toHaveBeenLastCalledWith({ base64: "AA==" });
  expect(tree.root.findAllByProps({ testID: "product-photo-preview" }).length).toBeGreaterThan(0);

  await press("products.photo.remove");
  expect(clearProductPhoto).not.toHaveBeenCalled();
  expect(onPendingChange).toHaveBeenLastCalledWith(null);
});

describe("competitor photo suggested on a new product (from À sourcer)", () => {
  const suggestedImage = () =>
    tree.root.findAll(
      (n) => n.props.testID === "product-photo-suggested" && typeof n.type !== "string"
    );

  it("shows the competitor's photo in the form right away, with its hint and a Remove button", async () => {
    await render({ productId: null, suggestedUrl: "https://shop/a.jpg" });
    expect(suggestedImage()).toHaveLength(1);
    expect(suggestedImage()[0].props.source).toEqual({ uri: "https://shop/a.jpg" });
    expect(JSON.stringify(tree.toJSON())).toContain("products.photo.fromCompetitor");
    expect(labels()).toContain("products.photo.remove");
  });

  it("removing it asks first, hides it and tells the screen not to copy it", async () => {
    const onSuggestedRemoved = jest.fn();
    await render({ productId: null, suggestedUrl: "https://shop/a.jpg", onSuggestedRemoved });
    await press("products.photo.remove");
    expect(confirmDestructive).toHaveBeenCalled();
    expect(suggestedImage()).toHaveLength(0);
    expect(onSuggestedRemoved).toHaveBeenCalled();
  });

  it("picking the owner's own photo replaces it and tells the screen", async () => {
    jest.mocked(pickProductPhoto).mockResolvedValue({
      prepared: { base64: "AA==" },
      previewUri: "data:image/jpeg;base64,AA==",
    });
    const onSuggestedRemoved = jest.fn();
    const onPendingChange = jest.fn();
    await render({
      productId: null,
      suggestedUrl: "https://shop/a.jpg",
      onSuggestedRemoved,
      onPendingChange,
    });
    await press("products.photo.choose");
    expect(suggestedImage()).toHaveLength(0);
    expect(onSuggestedRemoved).toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenCalledWith({ base64: "AA==" });
    expect(uploadProductPhoto).not.toHaveBeenCalled();
  });

  it("a photo that cannot load in the browser just disappears (the save still copies it server-side)", async () => {
    await render({ productId: null, suggestedUrl: "https://shop/blocked.jpg" });
    act(() => suggestedImage()[0].props.onError());
    expect(suggestedImage()).toHaveLength(0);
  });

  it("no suggestion, no preview", async () => {
    await render({ productId: null, suggestedUrl: null });
    expect(suggestedImage()).toHaveLength(0);
  });
});
