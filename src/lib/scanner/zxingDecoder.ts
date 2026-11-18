// The iOS Safari fallback. Only ever reached through a dynamic import() in
// webDecoder.ts, so it lands in its own chunk. Static imports here keep the
// whole library together in that chunk.
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

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
  ]);
  const reader = new BrowserMultiFormatReader(hints);
  return {
    decode: async (video) => {
      try {
        return reader.decode(video).getText();
      } catch {
        // NotFoundException, ChecksumException, FormatException: no code this frame.
        return null;
      }
    },
  };
}
