import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { launchImageLibraryAsync } from "expo-image-picker";
import { manipulateAsync } from "expo-image-manipulator";
import { router } from "expo-router";
import Capture from "../../app/(app)/stock-in/invoice/capture";
import { BigButton } from "../../src/components/BigButton";
import {
  createInvoiceDraft,
  extractInvoice,
  uploadInvoicePage,
} from "../../src/lib/stock/invoices";

let mockOffline = false;
jest.mock("@react-native-community/netinfo", () => ({
  useNetInfo: () => ({ isConnected: !mockOffline }),
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: jest.fn(),
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "owner" } }),
}));
jest.mock("../../src/lib/stock/invoices", () => ({
  createInvoiceDraft: jest.fn(),
  extractInvoice: jest.fn(),
  uploadInvoicePage: jest.fn(),
}));

afterEach(() => {
  mockOffline = false;
  jest.clearAllMocks();
});

it("makes no capture or draft requests while offline", async () => {
  mockOffline = true;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Capture />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain("invoices.offline");
  expect(tree.root.findAllByType(BigButton).every((button) => button.props.disabled)).toBe(true);
  expect(createInvoiceDraft).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it("retries a partial upload using the same draft and starts extraction only when all pages are present", async () => {
  jest.mocked(createInvoiceDraft).mockResolvedValue("draft-1");
  jest.mocked(launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "one", width: 1000, height: 2300 },
      { uri: "two", width: 2300, height: 1000 },
    ],
  });
  jest
    .mocked(manipulateAsync)
    .mockResolvedValue({ uri: "jpeg", width: 1600, height: 800, base64: "AA==" });
  jest
    .mocked(uploadInvoicePage)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  jest.mocked(extractInvoice).mockResolvedValue(undefined);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Capture />);
  });
  const press = (label: string) =>
    tree.root
      .findAllByType(BigButton)
      .find((b) => b.props.label === label)!
      .props.onPress();
  await act(async () => {
    await press("invoices.pickPhotos");
  });
  await act(async () => {
    await press("invoices.extract");
  });
  expect(extractInvoice).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("invoices.uploadError");
  await act(async () => {
    await press("invoices.extract");
  });
  expect(createInvoiceDraft).toHaveBeenCalledTimes(1);
  expect(jest.mocked(uploadInvoicePage).mock.calls.map(([id, page]) => [id, page])).toEqual([
    ["draft-1", 2],
    ["draft-1", 1],
    ["draft-1", 1],
  ]);
  expect(manipulateAsync).toHaveBeenCalledWith("two", [{ resize: { width: 1600 } }], {
    format: "jpeg",
    compress: 0.7,
    base64: true,
  });
  expect(extractInvoice).toHaveBeenCalledWith("draft-1");
  expect(router.replace).toHaveBeenCalledWith(
    expect.objectContaining({ params: { id: "draft-1" } })
  );
  act(() => tree.unmount());
});
