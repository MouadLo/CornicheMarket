import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { WebPhotoSection } from "../../src/components/webstore/WebPhotoSection";
import { confirmDestructive } from "../../src/lib/confirmDestructive";
import { showToast } from "../../src/lib/dialog/store";
import { pickProductPhoto } from "../../src/lib/products/photoPicker";
import {
  copyAppPhotoToWeb,
  removeWebImageFile,
  setImageSource,
  uploadWebImage,
} from "../../src/lib/webstore/imageQueries";
import { findPressable, hasText, webProduct } from "./helpers";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/dialog/store", () => ({ showToast: jest.fn(), confirm: jest.fn() }));
jest.mock("../../src/lib/confirmDestructive", () => ({ confirmDestructive: jest.fn() }));
jest.mock("../../src/lib/products/photoPicker", () => ({ pickProductPhoto: jest.fn() }));
jest.mock("../../src/lib/products/photoUrls", () => ({ usePhotoUrl: () => null }));
jest.mock("../../src/lib/webstore/imageQueries", () => ({
  uploadWebImage: jest.fn(),
  copyAppPhotoToWeb: jest.fn(),
  setImageSource: jest.fn(),
  removeWebImageFile: jest.fn(),
}));

let tree: ReactTestRenderer;
const onChange = jest.fn();
const render = async (product = webProduct(), appPhotoPath: string | null = null) => {
  await act(async () => {
    tree = create(
      <WebPhotoSection product={product} appPhotoPath={appPhotoPath} onChange={onChange} />
    );
  });
};
const press = async (label: string) => {
  await act(async () => {
    await findPressable(tree.root, label).props.onPress();
  });
};
const radio = (label: string) =>
  tree.root.findAll((n) => n.props.accessibilityRole === "radio" && hasText(n, label))[0];
const has = (label: string) => hasText(tree.root, label);
const withFile = () =>
  webProduct({
    image_url: "https://img.example/a.jpg",
    image_path: "p001/1.jpg",
    image_source: "url",
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(confirmDestructive).mockResolvedValue(true);
  jest.mocked(setImageSource).mockResolvedValue();
  jest.mocked(uploadWebImage).mockResolvedValue("p001/9.jpg");
  jest.mocked(copyAppPhotoToWeb).mockResolvedValue("p001/8.jpg");
  jest.mocked(removeWebImageFile).mockResolvedValue();
  jest
    .mocked(pickProductPhoto)
    .mockResolvedValue({ prepared: { base64: "AA==" }, previewUri: "data:x" });
});
afterEach(() => act(() => tree.unmount()));

it("with no picture shows the placeholder and no destructive or app buttons", async () => {
  await render();
  expect(tree.root.findAllByProps({ testID: "web-image-fallback" }).length).toBeGreaterThan(0);
  expect(has("webstore.photoNoLink")).toBe(true);
  expect(has("webstore.photoRemove")).toBe(false);
  expect(has("webstore.photoUseApp")).toBe(false);
  expect(tree.root.findAllByProps({ testID: "web-app-photo-card" })).toHaveLength(0);
});

it("before any upload there is no source switch to confuse with an upload button: the upload buttons come first and a hint says how to add a photo", async () => {
  await render();
  expect(radio("webstore.photoSourceFile")).toBeUndefined();
  expect(radio("webstore.photoSourceLink")).toBeUndefined();
  expect(has("webstore.photoNoFileYet")).toBe(true);
  expect(has("webstore.photoTake")).toBe(true);
  expect(has("webstore.photoChoose")).toBe(true);
  expect(has("webstore.photoShownTitle")).toBe(false);
});

describe("choosing the source", () => {
  it("saves the choice at once, tells the screen, and deletes nothing", async () => {
    await render(withFile());
    await act(async () => radio("webstore.photoSourceFile").props.onPress());
    expect(onChange).toHaveBeenCalledWith({ image_source: "file" });
    expect(setImageSource).toHaveBeenCalledWith("p001", "file");
    expect(removeWebImageFile).not.toHaveBeenCalled();
    expect(confirmDestructive).not.toHaveBeenCalled();
  });

  it("tapping a thumbnail chooses it too, and marks the active one", async () => {
    await render(withFile());
    expect(has("webstore.photoThumbLink · webstore.photoActive")).toBe(true);
    await press("webstore.photoThumbFile");
    expect(setImageSource).toHaveBeenCalledWith("p001", "file");
  });

  it("reverts and says so when saving fails", async () => {
    jest.mocked(setImageSource).mockRejectedValue(new Error("offline"));
    await render(withFile());
    await act(async () => radio("webstore.photoSourceFile").props.onPress());
    expect(onChange).toHaveBeenNthCalledWith(1, { image_source: "file" });
    expect(onChange).toHaveBeenNthCalledWith(2, { image_source: "url" });
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "webstore.photoSourceError" })
    );
  });
});

describe("uploading", () => {
  it.each([
    ["webstore.photoTake", "camera"],
    ["webstore.photoChoose", "library"],
  ] as const)("%s picks from the %s and uploads", async (label, source) => {
    await render();
    await press(label);
    expect(pickProductPhoto).toHaveBeenCalledWith(source);
    expect(uploadWebImage).toHaveBeenCalledWith("p001", { base64: "AA==" });
    expect(onChange).toHaveBeenCalledWith({ image_path: "p001/9.jpg", image_source: "file" });
  });

  it("a refused camera uploads nothing", async () => {
    jest.mocked(pickProductPhoto).mockResolvedValue("denied");
    await render();
    await press("webstore.photoTake");
    expect(uploadWebImage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "webstore.photoCameraDenied" })
    );
  });

  it("a cancelled picker does nothing, a failed upload shows a message and changes nothing", async () => {
    jest.mocked(pickProductPhoto).mockResolvedValueOnce(null);
    await render();
    await press("webstore.photoChoose");
    expect(uploadWebImage).not.toHaveBeenCalled();
    jest.mocked(uploadWebImage).mockRejectedValue(new Error("boom"));
    await press("webstore.photoChoose");
    expect(onChange).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "webstore.photoError" })
    );
  });
});

describe("the app photo", () => {
  it("is offered only when there is one", async () => {
    await render(webProduct(), "a1/x.jpg");
    expect(tree.root.findAllByProps({ testID: "web-app-photo-card" }).length).toBeGreaterThan(0);
    expect(has("webstore.photoUseApp")).toBe(true);
  });

  it("copies it without asking when nothing was uploaded", async () => {
    await render(webProduct(), "a1/x.jpg");
    await press("webstore.photoUseApp");
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(copyAppPhotoToWeb).toHaveBeenCalledWith("p001", "a1/x.jpg");
    expect(onChange).toHaveBeenCalledWith({ image_path: "p001/8.jpg", image_source: "file" });
  });

  it("asks before replacing an uploaded photo, and copies nothing when declined", async () => {
    jest.mocked(confirmDestructive).mockResolvedValue(false);
    await render(withFile(), "a1/x.jpg");
    await press("webstore.photoUseApp");
    expect(confirmDestructive).toHaveBeenCalled();
    expect(copyAppPhotoToWeb).not.toHaveBeenCalled();
  });
});

describe("deleting the uploaded photo", () => {
  it("asks first, then removes only the file and goes back to the link", async () => {
    await render(withFile());
    await press("webstore.photoRemove");
    expect(confirmDestructive).toHaveBeenCalled();
    expect(removeWebImageFile).toHaveBeenCalledWith("p001");
    expect(onChange).toHaveBeenCalledWith({ image_path: null, image_source: "url" });
  });

  it("does nothing when declined", async () => {
    jest.mocked(confirmDestructive).mockResolvedValue(false);
    await render(withFile());
    await press("webstore.photoRemove");
    expect(removeWebImageFile).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
