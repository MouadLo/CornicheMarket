// Turns a camera's stream of reads into scans. Pure, so it is tested without a
// camera; the native and the web camera views both use it.
import {
  cleanScannedCode,
  isValidGtin,
  upcEToUpcA,
  type BarcodeFormatName,
} from "@/src/lib/scanner/barcode";

export type ScanRead = { text: string; format: BarcodeFormatName };

// A code must have gone unseen this long before the same code is accepted
// again (a second identical item: take the first one away, show the next).
export const LEAVE_FRAME_MS = 1000;
// A code without a strong check needs a second sighting within this window.
export const CONFIRM_WINDOW_MS = 1000;

// EAN-13, UPC-A and Code 128 carry a check that readers verify, and are long
// enough not to be a fragment of another code: one read is enough. EAN-8 and
// UPC-E can be a misread fragment of a longer code, and Code 39 has no check,
// so those need the same text twice. Two reads in a row were required before
// for every format; a camera that reads a held code only every other frame
// then never confirmed it, which is why some codes "would not scan". A QR (the
// loyalty card) has its own error correction: one read is enough.
const ONE_READ: ReadonlySet<BarcodeFormatName> = new Set(["ean13", "upca", "code128", "qr"]);

// Rejects reads whose digits cannot be that format (a damaged read).
export function plausibleRead(text: string, format: BarcodeFormatName): boolean {
  switch (format) {
    case "ean13":
      return /^\d{13}$/.test(text) && isValidGtin(text);
    case "upca":
      return (
        (/^\d{12}$/.test(text) && isValidGtin(text)) || (/^\d{13}$/.test(text) && isValidGtin(text))
      );
    case "ean8":
      return /^\d{8}$/.test(text) && isValidGtin(text);
    case "upce":
      return /^\d{6,8}$/.test(text) && (text.length !== 8 || upcEToUpcA(text) !== null);
    default:
      return text.length > 0;
  }
}

// push(read, now) takes one read (null when a decode found nothing) and returns
// the code to hand to the app, or null.
//
// An accepted code is held until it has gone unseen for leaveMs, and EVERY
// sighting refreshes it, so a barcode left in front of the camera is one item,
// not one item per second. Codes are held separately, so two barcodes in view
// cannot re-add each other.
export function createScanFilter(options: { leaveMs?: number } = {}) {
  const leaveMs = options.leaveMs ?? LEAVE_FRAME_MS;
  const held = new Map<string, number>();
  const pending = new Map<string, number>();
  return {
    push(read: ScanRead | null, now: number): string | null {
      for (const [code, seenAt] of held) if (now - seenAt >= leaveMs) held.delete(code);
      for (const [code, seenAt] of pending) {
        if (now - seenAt > CONFIRM_WINDOW_MS) pending.delete(code);
      }
      if (!read) return null;
      const code = cleanScannedCode(read.text);
      if (!code) return null;
      if (held.has(code)) {
        held.set(code, now);
        return null;
      }
      if (!plausibleRead(code, read.format)) return null;
      if (!ONE_READ.has(read.format)) {
        if (!pending.has(code)) {
          pending.set(code, now);
          return null;
        }
        pending.delete(code);
      }
      held.set(code, now);
      return code;
    },
    reset() {
      held.clear();
      pending.clear();
    },
  };
}
