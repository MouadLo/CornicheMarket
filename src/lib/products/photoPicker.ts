import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { preparePhoto, type PreparedPhoto } from "@/src/lib/products/photos";

export type PickedPhoto = { prepared: PreparedPhoto; previewUri: string };

// The camera, or a file / the library. Resolves null when the person cancels,
// "denied" when the camera permission is refused. Works on web too (the picker
// opens the browser's file chooser; on a phone the camera option).
export async function pickProductPhoto(
  source: "camera" | "library"
): Promise<PickedPhoto | "denied" | null> {
  if (
    source === "camera" &&
    Platform.OS !== "web" &&
    !(await ImagePicker.requestCameraPermissionsAsync()).granted
  ) {
    return "denied";
  }
  const options = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const prepared = await preparePhoto(asset.uri, asset.width ?? 0, asset.height ?? 0);
  return { prepared, previewUri: `data:image/jpeg;base64,${prepared.base64}` };
}
