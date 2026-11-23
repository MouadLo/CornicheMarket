import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { UsePhoto } from "../../src/components/competitors/CatalogCard";
import { confirm, showToast } from "../../src/lib/dialog/store";
import { copyCompetitorPhoto, fetchProductPhotoPath } from "../../src/lib/products/photos";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/dialog/store", () => ({ showToast: jest.fn(), confirm: jest.fn() }));
jest.mock("../../src/lib/products/photos", () => ({
  copyCompetitorPhoto: jest.fn(),
  fetchProductPhotoPath: jest.fn(),
}));
jest.mock("../../src/lib/competitors/imageDownload", () => ({
  downloadCompetitorImage: jest.fn(),
}));
jest.mock("../../src/components/ui/Money", () => ({ Money: () => null }));
jest.mock("../../src/components/ui/StatusPill", () => ({ StatusPill: () => null }));

let tree: ReactTestRenderer;
const press = async () => {
  const [button] = tree.root.findAll(
    (n) => typeof n.props.onPress === "function" && n.props.accessibilityRole === "button"
  );
  await act(async () => {
    await button.props.onPress();
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(copyCompetitorPhoto).mockResolvedValue("saved");
  act(() => {
    tree = create(<UsePhoto imageUrl="https://shop/a.jpg" productId="p1" />);
  });
});
afterEach(() => act(() => tree.unmount()));

it("copies the photo straight away when the product has none", async () => {
  jest.mocked(fetchProductPhotoPath).mockResolvedValue(null);
  await press();
  expect(confirm).not.toHaveBeenCalled();
  expect(copyCompetitorPhoto).toHaveBeenCalledWith("https://shop/a.jpg", "p1");
  expect(showToast).toHaveBeenCalledWith({
    text: "competitors.catalog.usePhotoDone",
    tone: "success",
  });
});

it("asks before replacing an existing photo, and does nothing on no", async () => {
  jest.mocked(fetchProductPhotoPath).mockResolvedValue("p1/old.jpg");
  jest.mocked(confirm).mockResolvedValueOnce(false);
  await press();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(copyCompetitorPhoto).not.toHaveBeenCalled();

  jest.mocked(confirm).mockResolvedValueOnce(true);
  await press();
  expect(copyCompetitorPhoto).toHaveBeenCalledTimes(1);
});

it("a refused or failed copy only shows an info toast", async () => {
  jest.mocked(fetchProductPhotoPath).mockResolvedValue(null);
  jest.mocked(copyCompetitorPhoto).mockResolvedValueOnce("refused");
  await press();
  expect(showToast).toHaveBeenLastCalledWith({
    text: "competitors.catalog.photoRefused",
    tone: "info",
  });
  jest.mocked(copyCompetitorPhoto).mockRejectedValueOnce(new Error("x"));
  await press();
  expect(showToast).toHaveBeenLastCalledWith({
    text: "competitors.catalog.usePhotoError",
    tone: "info",
  });
});
