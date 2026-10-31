import { Alert, Platform } from "react-native";

// Void sale, void delivery and stock-adjustment all move stock or money
// backward in one tap today, with nothing between the tap and the write.
// This is the one gate they share: a message that states exactly what is
// about to change, and a real yes/no the caller must await before writing.
//
// react-native-web's Alert.alert is a no-op (it does nothing at all, not
// even a browser dialog), so native and web need different mechanics here;
// window.confirm is the standard, expected pattern for a blocking
// yes/no on web and needs no extra UI work to read correctly in RTL.
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  cancelLabel: string
): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(
      typeof window !== "undefined" ? window.confirm(`${title}\n\n${message}`) : false
    );
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
