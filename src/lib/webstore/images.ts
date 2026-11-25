// Pure rules of the webstore photos (migration 057). A web product has up to
// two pictures of its own: the image link (image_url) and a file uploaded for
// the site (image_path, public bucket 'webstore-images'). `image_source` says
// which one the site shows. The app's own product photo can be copied in as the
// uploaded file; it is never shown from here directly.
import type { ImageSource, WebProduct } from "./types";

export const WEB_IMAGE_BUCKET = "webstore-images";

type ImageFields = Pick<WebProduct, "image_url" | "image_path" | "image_source">;

// The project's public address (no trailing slash), from the same setting the
// Supabase client uses.
export function webImageBase(): string {
  return (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
}

// The public address of an uploaded file.
export function webImageUrl(path: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${WEB_IMAGE_BUCKET}/${path}`;
}

// The picture of the uploaded file, or null when there is none.
export function fileImage(wp: Pick<WebProduct, "image_path">, base: string): string | null {
  return wp.image_path ? webImageUrl(wp.image_path, base) : null;
}

// The link's picture, or null.
export function linkImage(wp: Pick<WebProduct, "image_url">): string | null {
  const url = (wp.image_url ?? "").trim();
  return url === "" ? null : url;
}

// What the site shows for this product (the same rule as the feed in SQL).
export function effectiveImage(wp: ImageFields, base: string): string | null {
  if (wp.image_source === "file" && wp.image_path) return webImageUrl(wp.image_path, base);
  return linkImage(wp);
}

// <web product id>/<timestamp>.jpg: a new name for every upload, so a picture
// is never overwritten (browsers and the site's cache never show an old one).
export function newWebImagePath(webId: string, now: number): string {
  return `${webId}/${Math.floor(now)}.jpg`;
}

// The shape migration 057 accepts.
export function isValidWebImagePath(path: string | null | undefined): boolean {
  return !!path && /^[A-Za-z0-9_-]{1,20}\/[A-Za-z0-9._-]{1,80}$/.test(path);
}

// A source can be chosen when what it needs exists: the file needs an upload.
// The link may be chosen even without a link (the site then shows no photo).
export function canUseSource(wp: Pick<WebProduct, "image_path">, source: ImageSource): boolean {
  return source === "url" || !!wp.image_path;
}
