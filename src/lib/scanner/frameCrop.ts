// Which part of a camera frame to decode. Pure, so it is tested without a
// camera. The live video fills the screen with object-fit: cover, and the
// person lines the barcode up with the aiming box in the middle; decoding the
// box (with some margin) instead of the whole frame is several times less
// work for the software decoder and ignores other barcodes on the shelf.

export const AIM_BOX = { widthRatio: 0.78, maxWidth: 420, aspect: 1.7 };
// The decoded area is the aiming box grown by these factors (clamped to the
// screen): barcodes are rarely held exactly inside the lines.
const GROW_WIDTH = 1.3;
const GROW_HEIGHT = 2;
// The software decoder needs no more pixels than this across: an EAN-13 is 95
// bars wide, so this still gives it about 9 pixels per bar.
export const MAX_DECODE_WIDTH = 900;

export type Rect = { x: number; y: number; w: number; h: number };

export function aimCropRect(
  videoWidth: number,
  videoHeight: number,
  viewWidth: number,
  viewHeight: number
): Rect | null {
  if (!(videoWidth > 0 && videoHeight > 0)) return null;
  if (!(viewWidth > 0 && viewHeight > 0)) {
    return { x: 0, y: 0, w: videoWidth, h: videoHeight };
  }
  // object-fit: cover, centred: screen pixels per video pixel.
  const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
  const aimWidth = Math.min(viewWidth * AIM_BOX.widthRatio, AIM_BOX.maxWidth);
  const aimHeight = aimWidth / AIM_BOX.aspect;
  const boxWidth = Math.min(viewWidth, aimWidth * GROW_WIDTH) / scale;
  const boxHeight = Math.min(viewHeight, aimHeight * GROW_HEIGHT) / scale;
  const w = Math.min(videoWidth, Math.round(boxWidth));
  const h = Math.min(videoHeight, Math.round(boxHeight));
  return {
    x: Math.round((videoWidth - w) / 2),
    y: Math.round((videoHeight - h) / 2),
    w,
    h,
  };
}

// The size to draw the cropped area at: never enlarged, shrunk to fit.
export function decodeSize(rect: Rect): { width: number; height: number } {
  const ratio = Math.min(1, MAX_DECODE_WIDTH / rect.w);
  return {
    width: Math.max(1, Math.round(rect.w * ratio)),
    height: Math.max(1, Math.round(rect.h * ratio)),
  };
}
