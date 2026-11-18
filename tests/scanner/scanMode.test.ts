import { cameraScanAvailable, type ScanEnv } from "../../src/lib/scanner/scanMode";

const env = (over: Partial<ScanEnv>): ScanEnv => ({
  platform: "web",
  coarsePointer: false,
  hasGetUserMedia: true,
  secureContext: true,
  ...over,
});

describe("cameraScanAvailable", () => {
  it("a phone or tablet (coarse pointer + camera API) gets the camera button", () => {
    expect(cameraScanAvailable(env({ coarsePointer: true }))).toBe(true);
  });

  it("a desktop or laptop does not, even with a webcam", () => {
    expect(cameraScanAvailable(env({ coarsePointer: false, hasGetUserMedia: true }))).toBe(false);
  });

  it("a coarse-pointer device without a camera API on a secure page does not", () => {
    expect(cameraScanAvailable(env({ coarsePointer: true, hasGetUserMedia: false }))).toBe(false);
  });

  it("a phone on an insecure page still gets the button, so it can explain why", () => {
    expect(
      cameraScanAvailable(
        env({ coarsePointer: true, hasGetUserMedia: false, secureContext: false })
      )
    ).toBe(true);
  });

  it("the native apps behave as before: always the camera", () => {
    for (const platform of ["ios", "android"]) {
      expect(
        cameraScanAvailable(
          env({ platform, coarsePointer: false, hasGetUserMedia: false, secureContext: true })
        )
      ).toBe(true);
    }
  });
});
