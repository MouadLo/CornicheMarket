// The iOS Safari fallback. Only ever reached through a dynamic import() in
// webDecoder.ts, so it lands in its own chunk. Static imports here keep the
// whole library together in that chunk.
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

import { normalizeFormat } from "@/src/lib/scanner/barcode";
import { aimCropRect, decodeSize } from "@/src/lib/scanner/frameCrop";

import type { FrameDecoder } from "./webDecoder";

export function createZxingDecoder(): FrameDecoder {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
  ]);
  // Scans more rows (and a rotated pass) per frame. Affordable because only
  // the area around the aiming box is decoded, not the whole frame.
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  // One canvas for the whole session instead of one per frame.
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  return {
    kind: "zxing",
    decode: async (video) => {
      const rect = aimCropRect(
        video.videoWidth,
        video.videoHeight,
        video.clientWidth,
        video.clientHeight
      );
      if (!rect || !context) return null;
      const size = decodeSize(rect);
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      context.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, size.width, size.height);
      try {
        const result = reader.decodeFromCanvas(canvas);
        return {
          text: result.getText(),
          format: normalizeFormat(BarcodeFormat[result.getBarcodeFormat()]),
        };
      } catch {
        // NotFoundException, ChecksumException, FormatException: no code this frame.
        return null;
      }
    },
  };
}
