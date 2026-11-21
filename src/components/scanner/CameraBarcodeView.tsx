import { useRef, type ReactNode } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StyleSheet, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { normalizeFormat } from "@/src/lib/scanner/barcode";
import { createScanFilter } from "@/src/lib/scanner/scanFilter";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

export type CameraBarcodeViewProps = {
  onBarcode: (code: string) => void;
  onClose: () => void;
  // The permission prompt of the native app; the web view does not use it
  // (the browser asks by itself).
  permissionTexts: { needed: string; allow: string; cancel: string };
  // Feed, hint and buttons laid over the live camera; hidden while the view
  // shows a permission or failure screen of its own.
  children?: ReactNode;
};

// Native camera: expo-camera does the decoding and the permission flow. It
// reports a code many times a second while it is in view; the scan filter
// turns that into one scan per item (see createScanFilter).
export function CameraBarcodeView({
  onBarcode,
  onClose,
  permissionTexts,
  children,
}: CameraBarcodeViewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const filter = useRef<ReturnType<typeof createScanFilter> | null>(null);
  if (!filter.current) filter.current = createScanFilter();

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{permissionTexts.needed}</Text>
        <BigButton label={permissionTexts.allow} onPress={requestPermission} />
        <BigButton label={permissionTexts.cancel} variant="secondary" onPress={onClose} />
      </View>
    );
  }

  return (
    <>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"],
        }}
        onBarcodeScanned={({ data, type }) => {
          const code = filter.current?.push(
            { text: data, format: normalizeFormat(type) },
            Date.now()
          );
          if (code) onBarcode(code);
        }}
      />
      {children}
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  message: { color: colors.white, fontSize: 16, textAlign: "center", marginBottom: 12 },
});
