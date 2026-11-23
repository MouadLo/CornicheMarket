import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { imageFileName } from "@/src/lib/competitors/catalog";
import { fetchCompetitorImage } from "@/src/lib/competitors/shops";

export type DownloadResult = "saved" | "refused" | "error";

// Saves a competitor's photo. The edge function fetches it (competitor image
// hosts do not allow cross-origin downloads); nothing is stored server-side.
// Web: a browser download. Native: written to the cache, then the share sheet
// opens so the owner can save it to Photos or Files.
export async function downloadCompetitorImage(
  imageUrl: string,
  productName: string
): Promise<DownloadResult> {
  const image = await fetchCompetitorImage(imageUrl);
  if (image.status === "refused") return "refused";
  if (image.status !== "ok") return "error";
  const filename = imageFileName(productName, image.extension);

  if (Platform.OS === "web") {
    const binary = atob(image.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: image.contentType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(objectUrl);
    return "saved";
  }

  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, image.base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: image.contentType, dialogTitle: filename });
  }
  return "saved";
}
