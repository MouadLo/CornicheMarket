// Data access for the webstore photos (migration 057). Choosing a picture never
// deletes another one: only an upload replaces the previous uploaded file, and
// removing the uploaded file deletes just that file. The image link and the
// app's own product photo are never touched.
import { decode } from "base64-arraybuffer";

import type { PreparedPhoto } from "@/src/lib/products/photos";
import { supabase } from "@/src/lib/supabase/client";
import { canUseSource, newWebImagePath, WEB_IMAGE_BUCKET } from "./images";
import type { ImageSource } from "./types";

const PRODUCT_PHOTO_BUCKET = "product-photos";

async function currentImage(
  webId: string
): Promise<{ image_path: string | null; image_source: ImageSource }> {
  const { data, error } = await supabase
    .from("web_products")
    .select("image_path, image_source")
    .eq("id", webId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { image_path: string | null; image_source: ImageSource } | null;
  if (!row) throw new Error("Unknown web product");
  return row;
}

// The old uploaded file is garbage once the row points elsewhere; failing to
// delete it must not undo the change.
async function removeFile(path: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage
    .from(WEB_IMAGE_BUCKET)
    .remove([path])
    .catch(() => undefined);
}

// Makes the stored file `path` the product's uploaded picture and the one the
// site shows; then deletes the previous uploaded file (if it was another one).
async function adoptFile(webId: string, path: string, previous: string | null): Promise<void> {
  const { error } = await supabase
    .from("web_products")
    .update({ image_path: path, image_source: "file" })
    .eq("id", webId);
  if (error) {
    await removeFile(path);
    throw new Error(error.message);
  }
  if (previous && previous !== path) await removeFile(previous);
}

// Uploads a picked picture for the site and shows it. Returns the new path.
export async function uploadWebImage(
  webId: string,
  photo: PreparedPhoto,
  now: number = Date.now()
): Promise<string> {
  const { image_path: previous } = await currentImage(webId);
  const path = newWebImagePath(webId, now);
  const uploaded = await supabase.storage
    .from(WEB_IMAGE_BUCKET)
    .upload(path, decode(photo.base64), { contentType: "image/jpeg", upsert: false });
  if (uploaded.error) throw new Error(uploaded.error.message);
  await adoptFile(webId, path, previous);
  return path;
}

// Copies the app's product photo (private bucket) into the webstore bucket and
// shows the copy. The app's photo itself stays untouched. Returns the new path.
// storage-js 2.118 can copy across buckets (destinationBucket).
export async function copyAppPhotoToWeb(
  webId: string,
  appPhotoPath: string,
  now: number = Date.now()
): Promise<string> {
  const { image_path: previous } = await currentImage(webId);
  const path = newWebImagePath(webId, now);
  const copied = await supabase.storage
    .from(PRODUCT_PHOTO_BUCKET)
    .copy(appPhotoPath, path, { destinationBucket: WEB_IMAGE_BUCKET });
  if (copied.error) throw new Error(copied.error.message);
  await adoptFile(webId, path, previous);
  return path;
}

// Chooses which picture the site shows. Deletes nothing.
export async function setImageSource(webId: string, source: ImageSource): Promise<void> {
  if (source === "file") {
    const { image_path } = await currentImage(webId);
    if (!canUseSource({ image_path }, source)) throw new Error("No uploaded photo");
  }
  const { error } = await supabase
    .from("web_products")
    .update({ image_source: source })
    .eq("id", webId);
  if (error) throw new Error(error.message);
}

// Deletes the uploaded file only. If the site was showing it, it goes back to
// the image link.
export async function removeWebImageFile(webId: string): Promise<void> {
  const { image_path } = await currentImage(webId);
  if (!image_path) return;
  const { error } = await supabase
    .from("web_products")
    .update({ image_path: null, image_source: "url" })
    .eq("id", webId);
  if (error) throw new Error(error.message);
  await removeFile(image_path);
}
