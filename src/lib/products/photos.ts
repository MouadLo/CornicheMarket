import { decode } from "base64-arraybuffer";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

import { fetchCompetitorImage } from "@/src/lib/competitors/shops";
import { forgetPhotoUrl } from "@/src/lib/products/photoUrls";
import {
  buildPhotoPath,
  PHOTO_BUCKET,
  PHOTO_QUALITY,
  resizeActions,
} from "@/src/lib/products/photoRules";
import { refreshGridCache } from "@/src/lib/sellGrid/refresh";
import { supabase } from "@/src/lib/supabase/client";

// One photo per product, kept in the private 'product-photos' bucket (migration
// 053). The owner changes it; every signed-in user can see it. Never shown to
// customers.

// A picture ready to upload: JPEG, at most 800 px on its long side.
export type PreparedPhoto = { base64: string };

// `width`/`height` come from the picker (0 when unknown).
export async function preparePhoto(
  uri: string,
  width: number,
  height: number
): Promise<PreparedPhoto> {
  const result = await manipulateAsync(uri, resizeActions(width, height), {
    compress: PHOTO_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!result.base64) throw new Error("Missing JPEG");
  return { base64: result.base64 };
}

// The same for bytes that came from a competitor's shop (base64 + type).
export async function preparePhotoFromBase64(
  base64: string,
  contentType: string,
  extension: string
): Promise<PreparedPhoto> {
  let uri = `data:${contentType};base64,${base64}`;
  if (Platform.OS !== "web") {
    uri = `${FileSystem.cacheDirectory}competitor-photo-${Crypto.randomUUID()}.${extension}`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  }
  // The size is read first, so a small picture is not enlarged.
  const probe = await manipulateAsync(uri, [], { format: SaveFormat.JPEG, compress: 1 });
  return preparePhoto(uri, probe.width, probe.height);
}

// Uploads the picture under a new name, makes it the product's photo, then
// deletes the previous file. Returns the new path.
export async function uploadProductPhoto(productId: string, photo: PreparedPhoto): Promise<string> {
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const path = buildPhotoPath(productId, Crypto.randomUUID());
  const uploaded = await bucket.upload(path, decode(photo.base64), {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);

  const { data, error } = await supabase.rpc("set_product_photo", {
    p_product_id: productId,
    p_path: path,
  });
  if (error) {
    await bucket.remove([path]).catch(() => undefined);
    throw new Error(error.message);
  }
  await removeOldFile(data as string | null);
  void refreshGridCache(true);
  return path;
}

// Removing a photo deletes the stored file.
export async function clearProductPhoto(productId: string): Promise<void> {
  const { data, error } = await supabase.rpc("clear_product_photo", { p_product_id: productId });
  if (error) throw new Error(error.message);
  await removeOldFile(data as string | null);
  void refreshGridCache(true);
}

// The old file is garbage once the product points elsewhere; a failure to
// delete it must not undo the change.
async function removeOldFile(path: string | null): Promise<void> {
  if (!path) return;
  forgetPhotoUrl(path);
  await supabase.storage
    .from(PHOTO_BUCKET)
    .remove([path])
    .catch(() => undefined);
}

// Owner only (the column is read from the products table).
export async function fetchProductPhotoPath(productId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("products")
    .select("photo_path")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { photo_path: string | null } | null)?.photo_path ?? null;
}

// The photo URL of a competitor's catalogue item (the new-product screen only
// knows the item's id).
export async function fetchCompetitorItemImageUrl(itemId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("competitor_catalog_items")
    .select("image_url")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { image_url: string | null } | null)?.image_url ?? null;
}

export type CopyResult = "saved" | "refused" | "error";

// Copies a competitor's photo (a URL already in our database) to a product. The
// edge function stores it as it is when it is a JPEG/PNG/WebP of at most 2 MB;
// otherwise the bytes come to the device, which resizes them and uploads them.
export async function copyCompetitorPhoto(
  imageUrl: string,
  productId: string
): Promise<CopyResult> {
  const { data, error } = await supabase.functions.invoke("competitor-image", {
    body: { url: imageUrl, saveToProductId: productId },
  });
  const answer = (error ? null : data) as {
    status?: string;
    detail?: string;
    path?: string;
  } | null;
  if (answer?.status === "saved") {
    void refreshGridCache(true);
    return "saved";
  }
  if (answer?.status === "refused") return "refused";
  if (answer?.detail !== "photo_unsupported" && answer?.detail !== "photo_too_large") {
    return "error";
  }
  const image = await fetchCompetitorImage(imageUrl);
  if (image.status === "refused") return "refused";
  if (image.status !== "ok") return "error";
  const prepared = await preparePhotoFromBase64(image.base64, image.contentType, image.extension);
  await uploadProductPhoto(productId, prepared);
  return "saved";
}
