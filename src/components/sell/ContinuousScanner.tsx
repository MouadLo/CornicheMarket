import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CameraBarcodeView } from "@/src/components/scanner/CameraBarcodeView";
import { useScanFeedback } from "@/src/lib/sales/scanFeedback";
import type { ScanOutcome } from "@/src/lib/sales/scanRules";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (barcode: string) => Promise<ScanOutcome>;
};

// Stays open across scans so a cashier can run a whole basket through
// without reopening the camera between items.
export function ContinuousScanner({ visible, onClose, onScanned }: Props) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<string[]>([]);
  const feedback = useScanFeedback(visible);

  const handleScan = async (code: string) => {
    // The camera view hands over a code once per item: it holds a code until
    // it has left the frame (see createScanFilter), on every platform.
    let outcome: ScanOutcome;
    try {
      outcome = await onScanned(code);
    } catch {
      outcome = { status: "error", message: null };
    }
    feedback(outcome.status);
    if (outcome.message) setFeed((current) => [outcome.message as string, ...current].slice(0, 6));
  };

  const close = () => {
    setFeed([]);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        <CameraBarcodeView
          onBarcode={handleScan}
          onClose={close}
          permissionTexts={{
            needed: t("sell.scannerCameraNeeded"),
            allow: t("sell.scannerAllowCamera"),
            cancel: t("common.cancel"),
          }}
        >
          <View style={styles.feed} pointerEvents="none">
            {feed.map((entry, index) => (
              <Text key={`${entry}-${index}`} style={styles.feedLine}>
                {entry}
              </Text>
            ))}
          </View>

          <View style={styles.overlay} pointerEvents="box-none">
            <Text style={styles.hint}>{t("sell.scannerKeepScanning")}</Text>
            <BigButton label={t("sell.scannerDone")} onPress={close} />
          </View>
        </CameraBarcodeView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  feed: { position: "absolute", top: 60, left: 20, right: 20, gap: 6 },
  feedLine: {
    color: colors.white,
    fontSize: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.control,
    overflow: "hidden",
  },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, gap: 12 },
  hint: { color: colors.white, fontSize: 16, textAlign: "center" },
});
