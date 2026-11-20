// Web only (imported from CameraBarcodeView.web.tsx). Reads one frame of a
// <video> and returns the barcode it shows, or null.
import { normalizeFormat } from "@/src/lib/scanner/barcode";
import type { ScanRead } from "@/src/lib/scanner/scanFilter";

export type FrameDecoder = {
  // "native": the browser's BarcodeDetector (fast, off the main thread).
  // "zxing": the bundled software decoder (iPhone Safari).
  kind: "native" | "zxing";
  decode: (video: HTMLVideoElement) => Promise<ScanRead | null>;
};

// Same formats as the native camera: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39.
export const DETECTOR_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

// What the browser's detector must read to be used. UPC-A and Code 39 are
// welcome but not required: a detector without upc_a (Apple's) reads a UPC-A
// as an EAN-13 with a leading 0, which the product lookup matches anyway.
export const REQUIRED_DETECTOR_FORMATS = ["ean_13", "ean_8", "upc_e", "code_128"];

// The browser's own detector when it reads the formats a shop needs (Chrome on
// Android); otherwise the bundled zxing fallback (iOS Safari).
export function pickDecoder(
  hasDetector: boolean,
  supported: readonly string[]
): "native" | "zxing" {
  return hasDetector && REQUIRED_DETECTOR_FORMATS.every((f) => supported.includes(f))
    ? "native"
    : "zxing";
}

export type Detected = {
  rawValue: string;
  format?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

// With several barcodes in view, the one nearest the middle (where the aiming
// box is) is the one being scanned.
export function pickCentered(
  found: readonly Detected[],
  width: number,
  height: number
): Detected | null {
  let best: Detected | null = null;
  let bestDistance = Infinity;
  for (const item of found) {
    if (!item.rawValue) continue;
    const box = item.boundingBox;
    const distance = box
      ? Math.hypot(box.x + box.width / 2 - width / 2, box.y + box.height / 2 - height / 2)
      : Number.MAX_SAFE_INTEGER;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

type DetectorLike = { detect: (source: CanvasImageSource) => Promise<Detected[]> };
type DetectorCtor = {
  new (options: { formats: string[] }): DetectorLike;
  getSupportedFormats: () => Promise<string[]>;
};

export async function createFrameDecoder(): Promise<FrameDecoder> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  let supported: string[] = [];
  if (Ctor) {
    try {
      supported = await Ctor.getSupportedFormats();
    } catch {
      supported = [];
    }
  }

  if (Ctor && pickDecoder(true, supported) === "native") {
    const detector = new Ctor({ formats: DETECTOR_FORMATS.filter((f) => supported.includes(f)) });
    return {
      kind: "native",
      decode: async (video) => {
        const found = await detector.detect(video);
        const best = pickCentered(found, video.videoWidth, video.videoHeight);
        return best ? { text: best.rawValue, format: normalizeFormat(best.format) } : null;
      },
    };
  }

  // Loaded only now, so desktop users and first load never download it.
  const { createZxingDecoder } = await import("./zxingDecoder");
  return createZxingDecoder();
}
