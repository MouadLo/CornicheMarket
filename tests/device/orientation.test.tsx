/**
 * app.json used to pin the whole app to portrait, which locked the counter
 * tablet out of landscape at the OS level. The lock now happens at runtime,
 * per device size: tablets landscape, phones portrait.
 */
import React from "react";
import { Dimensions, Platform } from "react-native";
import { act, create } from "react-test-renderer";

import { isTabletSize, orientationFor, useOrientationLock } from "../../src/lib/device/orientation";

const mockLockAsync = jest.fn(async (..._args: unknown[]) => {});
jest.mock("expo-screen-orientation", () => ({
  OrientationLock: { LANDSCAPE: "LANDSCAPE", PORTRAIT_UP: "PORTRAIT_UP" },
  lockAsync: (...args: unknown[]) => mockLockAsync(...args),
}));

describe("isTabletSize / orientationFor", () => {
  it("treats the 1280x800 counter tablet as a tablet, however it is held", () => {
    expect(isTabletSize(1280, 800)).toBe(true);
    expect(isTabletSize(800, 1280)).toBe(true);
  });

  it("treats a 360x800 phone as a phone", () => {
    expect(isTabletSize(360, 800)).toBe(false);
    expect(isTabletSize(800, 360)).toBe(false);
  });

  it("puts the tablet boundary at a 600 dp shortest side", () => {
    expect(isTabletSize(600, 960)).toBe(true);
    expect(isTabletSize(599, 960)).toBe(false);
  });

  it("tablets get landscape, phones portrait", () => {
    expect(orientationFor(800, 1280)).toBe("landscape");
    expect(orientationFor(360, 800)).toBe("portrait");
  });
});

describe("useOrientationLock", () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
    jest.restoreAllMocks();
    mockLockAsync.mockClear();
  });

  function mountWithWindow(width: number, height: number) {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width, height, scale: 2, fontScale: 1 });
    function Probe() {
      useOrientationLock();
      return null;
    }
    act(() => {
      create(<Probe />);
    });
  }

  it("locks a tablet to landscape", () => {
    Platform.OS = "android";
    mountWithWindow(800, 1280);
    expect(mockLockAsync).toHaveBeenCalledWith("LANDSCAPE");
  });

  it("locks a phone to portrait", () => {
    Platform.OS = "android";
    mountWithWindow(360, 800);
    expect(mockLockAsync).toHaveBeenCalledWith("PORTRAIT_UP");
  });

  it("does nothing on web, where browsers can't lock orientation", () => {
    Platform.OS = "web";
    mountWithWindow(1280, 800);
    expect(mockLockAsync).not.toHaveBeenCalled();
  });

  it("never lets a refused lock break startup", async () => {
    Platform.OS = "android";
    mockLockAsync.mockRejectedValueOnce(new Error("not supported"));
    expect(() => mountWithWindow(800, 1280)).not.toThrow();
    await act(async () => {});
  });
});

describe("app.json", () => {
  it("does not pin the app to portrait (that locks the tablet out of landscape)", () => {
    const appJson = require("../../app.json");
    expect(appJson.expo.orientation).not.toBe("portrait");
    expect(appJson.expo.orientation).toBe("default");
  });
});
