import React from "react";
import { Vibration } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import type { ScanOutcome } from "../../src/lib/sales/scanRules";

/* eslint-disable @typescript-eslint/no-require-imports */
const OK_SOUND = require("../../assets/sounds/scan-ok.wav");
const BAD_SOUND = require("../../assets/sounds/scan-bad.wav");

let mockCameraProps: Record<string, unknown> = {};
const mockPlayed: unknown[] = [];

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
  CameraView: (props: Record<string, unknown>) => {
    mockCameraProps = props;
    return null;
  },
}));
jest.mock("expo-av", () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(async (asset: unknown) => ({
        sound: {
          replayAsync: jest.fn(async () => {
            mockPlayed.push(asset);
          }),
          unloadAsync: jest.fn(async () => {}),
        },
      })),
    },
  },
}));

let now = 100_000;
let tree: ReactTestRenderer;
const onScanned = jest.fn<Promise<ScanOutcome>, [string]>();
let vibrate: jest.SpyInstance;

async function mount() {
  await act(async () => {
    tree = create(<ContinuousScanner visible onClose={() => {}} onScanned={onScanned} />);
  });
}

async function seen(code: string, at: number, type = "ean13") {
  now = at;
  await act(async () => {
    (mockCameraProps.onBarcodeScanned as (e: { data: string; type: string }) => void)({
      data: code,
      type,
    });
  });
}

beforeEach(() => {
  mockPlayed.length = 0;
  onScanned.mockReset();
  onScanned.mockResolvedValue({ status: "added", message: "Milk" });
  jest.spyOn(Date, "now").mockImplementation(() => now);
  vibrate = jest.spyOn(Vibration, "vibrate").mockImplementation(() => {});
  vibrate.mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

it("uses the rear camera and keeps scanning (no front camera)", async () => {
  await mount();
  expect(mockCameraProps.facing).toBe("back");
});

it("an accepted scan beeps once and vibrates once (short)", async () => {
  await mount();
  await seen("6111234567895", 100_000);

  expect(onScanned).toHaveBeenCalledTimes(1);
  expect(mockPlayed).toEqual([OK_SOUND]);
  expect(vibrate).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledWith(40);
});

it("a code held in front of the camera is one item, however long it stays", async () => {
  await mount();
  for (let at = 100_000; at <= 106_000; at += 300) await seen("6111234567895", at);

  expect(onScanned).toHaveBeenCalledTimes(1);
  expect(mockPlayed).toHaveLength(1);
  expect(vibrate).toHaveBeenCalledTimes(1);
});

it("the same code after it was out of view for 1 second is a second item", async () => {
  await mount();
  await seen("6111234567895", 100_000);
  await seen("6111234567895", 100_500); // still held
  await seen("6111234567895", 101_500); // unseen for 1 s: the next item

  expect(onScanned).toHaveBeenCalledTimes(2);
  expect(mockPlayed).toEqual([OK_SOUND, OK_SOUND]);
  expect(vibrate).toHaveBeenCalledTimes(2);
});

it("a damaged read (wrong check digit) never reaches the lookup", async () => {
  await mount();
  await seen("6111234567890", 100_000);
  expect(onScanned).not.toHaveBeenCalled();
});

it("a short EAN-8 needs to be seen twice before it is looked up", async () => {
  await mount();
  await seen("96385074", 100_000, "ean8");
  expect(onScanned).not.toHaveBeenCalled();
  await seen("96385074", 100_100, "ean8");
  expect(onScanned).toHaveBeenCalledWith("96385074");
});

it("a different code right away is accepted", async () => {
  await mount();
  await seen("6111234567895", 100_000);
  await seen("6119876543215", 100_050);
  expect(onScanned).toHaveBeenCalledTimes(2);
});

it("an unknown barcode gets the other, longer pattern and the low sound, not the beep", async () => {
  onScanned.mockResolvedValue({ status: "unknown", message: "sell.notFound" });
  await mount();
  await seen("0000000000000", 100_000);

  expect(mockPlayed).toEqual([BAD_SOUND]);
  expect(vibrate).toHaveBeenCalledTimes(1);
  const pattern = vibrate.mock.calls[0][0] as number[];
  expect(Array.isArray(pattern)).toBe(true);
  expect(pattern.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThan(40 * 4);
});

it("a failed lookup also uses the failure pattern", async () => {
  onScanned.mockResolvedValue({ status: "error", message: null });
  await mount();
  await seen("6111234567895", 100_000);
  expect(mockPlayed).toEqual([BAD_SOUND]);
});

it("a lookup that throws still gives failure feedback and doesn't break scanning", async () => {
  onScanned.mockRejectedValueOnce(new Error("boom"));
  await mount();
  await seen("6111234567895", 100_000);
  expect(mockPlayed).toEqual([BAD_SOUND]);

  onScanned.mockResolvedValue({ status: "added", message: "Milk" });
  await seen("6119876543215", 100_100);
  expect(mockPlayed).toEqual([BAD_SOUND, OK_SOUND]);
});

it("if the sound can't load, scanning and vibration still work", async () => {
  const { Audio } = jest.requireMock("expo-av");
  Audio.Sound.createAsync.mockRejectedValueOnce(new Error("no audio"));
  Audio.Sound.createAsync.mockRejectedValueOnce(new Error("no audio"));
  await mount();
  await seen("6111234567895", 100_000);
  expect(onScanned).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledTimes(1);
});
