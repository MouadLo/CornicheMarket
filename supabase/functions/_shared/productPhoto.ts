// Product photos kept in the private 'product-photos' bucket (migration 053).
// Pure helpers, so the tests run them without Deno.

export const PRODUCT_PHOTO_BUCKET = "product-photos";
// Same as the bucket's file_size_limit.
export const PRODUCT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

const STORABLE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type StorableDecision =
  | { ok: true; extension: "jpg" | "png" | "webp"; contentType: string }
  | { ok: false; reason: "unsupported_type" | "too_large" };

// A competitor's photo is stored as it is (no re-encoding in Deno) only when it
// is a JPEG, PNG or WebP of at most 2 MB. Anything else is refused with a reason
// and the app falls back to downloading it and resizing it on the device.
export function decideStorable(contentType: string, byteLength: number): StorableDecision {
  const extension = STORABLE[contentType.toLowerCase()];
  if (!extension) return { ok: false, reason: "unsupported_type" };
  if (byteLength > PRODUCT_PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };
  return {
    ok: true,
    extension: extension as "jpg" | "png" | "webp",
    contentType: extension === "jpg" ? "image/jpeg" : `image/${extension}`,
  };
}

// <product_id>/<uuid>.<ext>: the shape set_product_photo accepts.
export function productPhotoPath(productId: string, uuid: string, extension: string): string {
  return `${productId}/${uuid}.${extension}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
