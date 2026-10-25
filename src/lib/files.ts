import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: Platform.OS === "web" ? "text/csv" : "*/*",
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];

  if (Platform.OS === "web") {
    const text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
    return { name: asset.name, text };
  }

  const text = await FileSystem.readAsStringAsync(asset.uri);
  return { name: asset.name, text };
}

export async function saveTextFile(filename: string, content: string): Promise<void> {
  if (Platform.OS === "web") {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: filename });
  }
}
