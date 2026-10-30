import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";

import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (barcode: string) => Promise<string | null>;
};

const RESCAN_DELAY_MS = 1500;

// Stays open across scans so a cashier can run a whole basket through
// without reopening the camera between items.
export function ContinuousScanner({ visible, onClose, onScanned }: Props) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [feed, setFeed] = useState<string[]>([]);
  const lastScan = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const handleScan = async (code: string) => {
    const now = Date.now();
    // The camera reports the same code many times per second while it stays
    // in frame; only a repeat after the delay counts as a second item.
    if (lastScan.current.code === code && now - lastScan.current.at < RESCAN_DELAY_MS) return;
    lastScan.current = { code, at: now };

    const message = await onScanned(code);
    if (message) setFeed((current) => [message, ...current].slice(0, 6));
  };

  const close = () => {
    setFeed([]);
    lastScan.current = { code: "", at: 0 };
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.message}>{t("sell.scannerCameraNeeded")}</Text>
            <BigButton label={t("sell.scannerAllowCamera")} onPress={requestPermission} />
            <BigButton label={t("common.cancel")} variant="secondary" onPress={close} />
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39"],
              }}
              onBarcodeScanned={({ data }) => handleScan(data)}
            />

            <View style={styles.feed}>
              {feed.map((entry, index) => (
                <Text key={`${entry}-${index}`} style={styles.feedLine}>
                  {entry}
                </Text>
              ))}
            </View>

            <View style={styles.overlay}>
              <Text style={styles.hint}>{t("sell.scannerKeepScanning")}</Text>
              <BigButton label={t("sell.scannerDone")} onPress={close} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  message: { color: "#fff", fontSize: 16, textAlign: "center", marginBottom: 12 },
  feed: { position: "absolute", top: 60, left: 20, right: 20, gap: 6 },
  feedLine: {
    color: "#fff",
    fontSize: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    overflow: "hidden",
  },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, gap: 12 },
  hint: { color: "#fff", fontSize: 16, textAlign: "center" },
});
