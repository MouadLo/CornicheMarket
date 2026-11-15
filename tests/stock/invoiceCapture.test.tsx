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

let mockOnline = true;
jest.mock("@react-native-community/netinfo", () => ({
  useNetInfo: () => ({ isConnected: true, isInternetReachable: false }),
}));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ online: mockOnline }),
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
  mockOnline = true;
  jest.clearAllMocks();
});

async function capturePhoto() {
  jest.mocked(launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "one", width: 800, height: 800 }],
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Capture />);
  });
  const button = (label: string) =>
    tree.root.findAllByType(BigButton).find((b) => b.props.label === label)!;
  await act(async () => {
    await button("invoices.pickPhotos").props.onPress();
  });
  return { tree, button };
}

it("enables scan when the probe is online and NetInfo still reports unreachable", async () => {
  const { tree, button } = await capturePhoto();
  expect(JSON.stringify(tree.toJSON())).not.toContain("invoices.offline");
  expect(button("invoices.extract").props.disabled).toBe(false);
  act(() => tree.unmount());
});

it("allows scan when the last probe was offline and retries a failed function call on the same draft", async () => {
  mockOnline = false;
  jest.mocked(createInvoiceDraft).mockResolvedValue("draft-1");
  jest
    .mocked(manipulateAsync)
    .mockResolvedValue({ uri: "jpeg", width: 800, height: 800, base64: "AA==" });
  jest.mocked(uploadInvoicePage).mockResolvedValue(undefined);
  jest
    .mocked(extractInvoice)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);

  const { tree, button } = await capturePhoto();
  expect(JSON.stringify(tree.toJSON())).toContain("invoices.offline");
  expect(button("invoices.extract").props.disabled).toBe(false);
  await act(async () => {
    await button("invoices.extract").props.onPress();
  });
  expect(JSON.stringify(tree.toJSON())).toContain("invoices.uploadError");
  expect(router.replace).not.toHaveBeenCalled();

  await act(async () => {
    await button("invoices.retry").props.onPress();
  });
  expect(createInvoiceDraft).toHaveBeenCalledTimes(1);
  expect(uploadInvoicePage).toHaveBeenCalledTimes(1);
  expect(jest.mocked(extractInvoice).mock.calls).toEqual([["draft-1"], ["draft-1"]]);
  expect(router.replace).toHaveBeenCalledWith(
    expect.objectContaining({ params: { id: "draft-1" } })
  );
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
    await press("invoices.retry");
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
