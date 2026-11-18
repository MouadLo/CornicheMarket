import {
  CAMERA_CONSTRAINTS,
  classifyCameraError,
  createCameraController,
} from "../../src/lib/scanner/cameraSession";
import { DETECTOR_FORMATS, pickDecoder } from "../../src/lib/scanner/webDecoder";

function fakeStream() {
  const tracks = [{ stop: jest.fn() }, { stop: jest.fn() }];
  return { tracks, getTracks: () => tracks };
}
const allStopped = (s: ReturnType<typeof fakeStream>) =>
  s.tracks.every((t) => t.stop.mock.calls.length === 1);

describe("camera controller releases the camera", () => {
  it("stop() stops every track", async () => {
    const s = fakeStream();
    const c = createCameraController(async () => s);
    expect(await c.start()).toBe(s);
    c.stop();
    expect(allStopped(s)).toBe(true);
    expect(c.isLive()).toBe(false);
  });

  it("a start that resolves after stop() stops its own tracks and reports nothing", async () => {
    const s = fakeStream();
    let resolve!: (v: typeof s) => void;
    const c = createCameraController(() => new Promise<typeof s>((r) => (resolve = r)));
    const started = c.start();
    c.stop(); // modal closed while the browser is still asking
    resolve(s);
    expect(await started).toBeNull();
    expect(allStopped(s)).toBe(true);
    expect(c.isLive()).toBe(false);
  });

  it("restarting (page visible again) releases the previous stream first", async () => {
    const a = fakeStream();
    const b = fakeStream();
    const streams = [a, b];
    const c = createCameraController(async () => streams.shift()!);
    await c.start();
    await c.start();
    expect(allStopped(a)).toBe(true);
    expect(allStopped(b)).toBe(false);
    c.stop();
    expect(allStopped(b)).toBe(true);
  });

  it("stop() with nothing started is harmless", () => {
    expect(() => createCameraController(async () => fakeStream()).stop()).not.toThrow();
  });
});

describe("camera request", () => {
  it("asks for the rear camera with a retail-barcode resolution, no audio", () => {
    expect(CAMERA_CONSTRAINTS.audio).toBe(false);
    expect(CAMERA_CONSTRAINTS.video.facingMode).toEqual({ ideal: "environment" });
    expect(CAMERA_CONSTRAINTS.video.width.ideal).toBeGreaterThanOrEqual(1280);
  });
});

describe("classifyCameraError", () => {
  const ok = { hasGetUserMedia: true, secureContext: true };
  const named = (name: string) => Object.assign(new Error("raw browser text"), { name });

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "notFound"],
    ["OverconstrainedError", "notFound"],
    ["NotReadableError", "inUse"],
    ["AbortError", "inUse"],
    ["SomethingElse", "generic"],
  ])("%s -> %s", (name, kind) => {
    expect(classifyCameraError(named(name), ok)).toBe(kind);
  });

  it("an insecure page wins over whatever the browser said", () => {
    expect(classifyCameraError(named("NotAllowedError"), { ...ok, secureContext: false })).toBe(
      "insecure"
    );
  });

  it("no camera API on a secure page means no camera", () => {
    expect(
      classifyCameraError(new Error("x"), { hasGetUserMedia: false, secureContext: true })
    ).toBe("notFound");
  });
});

describe("pickDecoder", () => {
  it("uses the browser's detector when it reads every format", () => {
    expect(pickDecoder(true, DETECTOR_FORMATS)).toBe("native");
  });
  it("falls back to zxing without a detector (iOS Safari)", () => {
    expect(pickDecoder(false, [])).toBe("zxing");
  });
  it("falls back when the detector lacks a needed format", () => {
    expect(pickDecoder(true, ["qr_code", "ean_13"])).toBe("zxing");
  });
});
