import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../../src/components/BigButton";
import { CameraBarcodeView } from "../../src/components/scanner/CameraBarcodeView.web";

let mockEnv = { platform: "web", coarsePointer: true, hasGetUserMedia: true, secureContext: true };
let mockGetStream: () => Promise<unknown>;
const mockStop = jest.fn();

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/scanner/scanMode", () => ({ readScanEnv: () => mockEnv }));
jest.mock("../../src/lib/scanner/webDecoder", () => ({
  createFrameDecoder: async () => ({ decode: async () => null }),
}));
jest.mock("../../src/lib/scanner/cameraSession", () => {
  const actual = jest.requireActual("../../src/lib/scanner/cameraSession");
  return {
    ...actual,
    createCameraController: () => ({
      start: () => mockGetStream(),
      stop: mockStop,
      isLive: () => false,
    }),
  };
});

let tree: ReactTestRenderer;
const onClose = jest.fn();
const texts = () => tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join(""));
const open = async () => {
  await act(async () => {
    tree = create(
      <CameraBarcodeView
        onBarcode={jest.fn()}
        onClose={onClose}
        permissionTexts={{ needed: "", allow: "", cancel: "" }}
      >
        <Text>overlay</Text>
      </CameraBarcodeView>
    );
  });
};

// Jest runs in node: a minimal document for the visibilitychange listener.
let visibility = "visible";
const listeners = new Set<() => void>();
const fakeDocument = {
  get visibilityState() {
    return visibility;
  },
  addEventListener: (_: string, fn: () => void) => listeners.add(fn),
  removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
};
const g = globalThis as unknown as { document?: unknown };
beforeAll(() => {
  g.document = fakeDocument;
});
afterAll(() => {
  delete g.document;
});

beforeEach(() => {
  visibility = "visible";
  mockEnv = { platform: "web", coarsePointer: true, hasGetUserMedia: true, secureContext: true };
  mockStop.mockClear();
  onClose.mockClear();
});
afterEach(() => act(() => tree?.unmount()));

const fail = (name: string) => () =>
  Promise.reject(Object.assign(new Error("Permission denied raw text"), { name }));

it.each([
  ["NotAllowedError", "barcodeScanner.webDenied"],
  ["NotFoundError", "barcodeScanner.webNotFound"],
  ["NotReadableError", "barcodeScanner.webInUse"],
  ["WeirdError", "barcodeScanner.webGeneric"],
])("%s shows the translated message with Try again and Close", async (name, key) => {
  mockGetStream = fail(name);
  await open();
  expect(texts()).toContain(key);
  expect(texts().join("|")).not.toContain("Permission denied raw text");
  expect(texts()).not.toContain("overlay");
  const labels = tree.root.findAllByType(BigButton).map((b) => b.props.label);
  expect(labels).toEqual(["barcodeScanner.tryAgain", "barcodeScanner.close"]);
  act(() => tree.root.findAllByType(BigButton)[1].props.onPress());
  expect(onClose).toHaveBeenCalled();
});

it("an insecure page says so, without asking the browser", async () => {
  mockEnv = { ...mockEnv, hasGetUserMedia: false, secureContext: false };
  const spy = jest.fn();
  mockGetStream = spy as never;
  await open();
  expect(texts()).toContain("barcodeScanner.webInsecure");
  expect(spy).not.toHaveBeenCalled();
});

it("Try again asks for the camera again", async () => {
  const spy = jest.fn(fail("NotAllowedError"));
  mockGetStream = spy;
  await open();
  await act(async () => tree.root.findAllByType(BigButton)[0].props.onPress());
  expect(spy).toHaveBeenCalledTimes(2);
});

it("unmounting releases the camera", async () => {
  mockGetStream = () => new Promise(() => {});
  await open();
  act(() => tree.unmount());
  expect(mockStop).toHaveBeenCalled();
});

it("with a working camera the overlay is shown and no error", async () => {
  mockGetStream = () => new Promise(() => {});
  await open();
  expect(texts()).toContain("overlay");
});

it("a hidden page releases the camera and a visible one restarts it", async () => {
  const spy = jest.fn(() => new Promise(() => {}));
  mockGetStream = spy;
  await open();
  expect(spy).toHaveBeenCalledTimes(1);
  await act(async () => {
    visibility = "hidden";
    listeners.forEach((fn) => fn());
  });
  expect(mockStop).toHaveBeenCalled();
  expect(spy).toHaveBeenCalledTimes(1);
  await act(async () => {
    visibility = "visible";
    listeners.forEach((fn) => fn());
  });
  expect(spy).toHaveBeenCalledTimes(2);
});
