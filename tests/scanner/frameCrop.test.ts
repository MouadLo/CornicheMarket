import {
  AIM_BOX,
  MAX_DECODE_WIDTH,
  aimCropRect,
  decodeSize,
} from "../../src/lib/scanner/frameCrop";
import {
  pickCentered,
  pickDecoder,
  DETECTOR_FORMATS,
  REQUIRED_DETECTOR_FORMATS,
} from "../../src/lib/scanner/webDecoder";

describe("aimCropRect", () => {
  it("portrait phone, portrait 720x1280 stream: a centred band around the aiming box", () => {
    // 390x844 screen; cover scale = max(390/720, 844/1280) = 0.659...
    const rect = aimCropRect(720, 1280, 390, 844)!;
    const scale = Math.max(390 / 720, 844 / 1280);
    const aimWidth = 390 * AIM_BOX.widthRatio;
    expect(rect.w).toBe(Math.min(720, Math.round(Math.min(390, aimWidth * 1.3) / scale)));
    expect(rect.h).toBe(Math.round(((aimWidth / AIM_BOX.aspect) * 2) / scale));
    // centred
    expect(rect.x).toBe(Math.round((720 - rect.w) / 2));
    expect(rect.y).toBe(Math.round((1280 - rect.h) / 2));
    // much less than the whole frame
    expect(rect.w * rect.h).toBeLessThan(720 * 1280 * 0.4);
  });

  it("caps the aiming box on a wide screen", () => {
    const rect = aimCropRect(1280, 720, 1280, 720)!;
    expect(rect.w).toBe(Math.round(AIM_BOX.maxWidth * 1.3));
  });

  it("never leaves the frame", () => {
    const rect = aimCropRect(320, 240, 2000, 400)!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(320);
    expect(rect.y + rect.h).toBeLessThanOrEqual(240);
  });

  it("no video yet: nothing; no layout size: the whole frame", () => {
    expect(aimCropRect(0, 0, 390, 844)).toBeNull();
    expect(aimCropRect(640, 480, 0, 0)).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });
});

describe("decodeSize", () => {
  it("shrinks a wide crop, never enlarges a small one", () => {
    expect(decodeSize({ x: 0, y: 0, w: 1800, h: 600 })).toEqual({
      width: MAX_DECODE_WIDTH,
      height: 300,
    });
    expect(decodeSize({ x: 0, y: 0, w: 500, h: 200 })).toEqual({ width: 500, height: 200 });
  });
});

describe("pickDecoder", () => {
  it("uses the browser detector when it reads the formats a shop needs", () => {
    expect(pickDecoder(true, DETECTOR_FORMATS)).toBe("native");
    expect(pickDecoder(false, DETECTOR_FORMATS)).toBe("zxing");
    expect(pickDecoder(true, ["ean_13", "qr_code"])).toBe("zxing");
  });

  it("reads the loyalty card QR when the browser can, without requiring it", () => {
    expect(DETECTOR_FORMATS).toContain("qr_code");
    expect(REQUIRED_DETECTOR_FORMATS).not.toContain("qr_code");
    expect(pickDecoder(true, ["ean_13", "ean_8", "upc_e", "code_128"])).toBe("native");
  });

  it("a detector without upc_a (Apple's) is still used", () => {
    const apple = ["aztec", "code_128", "code_39", "code_93", "ean_13", "ean_8", "itf", "upc_e"];
    expect(pickDecoder(true, apple)).toBe("native");
    expect(
      pickDecoder(
        true,
        apple.filter((f) => f !== "upc_e")
      )
    ).toBe("zxing");
  });
});

describe("pickCentered", () => {
  const at = (rawValue: string, x: number, y: number) => ({
    rawValue,
    format: "ean_13",
    boundingBox: { x, y, width: 100, height: 40 },
  });

  it("takes the barcode nearest the middle of the frame", () => {
    const found = [at("edge", 0, 0), at("middle", 590, 340), at("other", 1100, 600)];
    expect(pickCentered(found, 1280, 720)?.rawValue).toBe("middle");
  });

  it("works without boxes and skips empty values", () => {
    expect(pickCentered([{ rawValue: "" }, { rawValue: "x" }], 100, 100)?.rawValue).toBe("x");
    expect(pickCentered([], 100, 100)).toBeNull();
  });
});
