// Web only (imported from CameraBarcodeView.web.tsx). Reads one frame of a
// <video> and returns the barcode text, or null.

export type FrameDecoder = { decode: (video: HTMLVideoElement) => Promise<string | null> };

// Same formats as the native camera: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39.
export const DETECTOR_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

// The browser's own detector when it reads every format we need (Chrome on
// Android); otherwise the bundled zxing fallback (iOS Safari).
export function pickDecoder(
  hasDetector: boolean,
  supported: readonly string[]
): "native" | "zxing" {
  return hasDetector && DETECTOR_FORMATS.every((f) => supported.includes(f)) ? "native" : "zxing";
}

type DetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
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
    const detector = new Ctor({ formats: DETECTOR_FORMATS });
    return {
      decode: async (video) => {
        const found = await detector.detect(video);
        return found[0]?.rawValue ?? null;
      },
    };
  }

  // Loaded only now, so desktop users and first load never download it.
  const { createZxingDecoder } = await import("./zxingDecoder");
  return createZxingDecoder();
}
