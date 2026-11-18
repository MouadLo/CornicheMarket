import { useRef } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CameraBarcodeView } from "@/src/components/scanner/CameraBarcodeView";
import { colors } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (barcode: string) => void;
};

export function BarcodeScannerModal({ visible, onClose, onScanned }: Props) {
  const { t } = useTranslation();
  // The camera fires continuously while a code is in frame; one scan is enough.
  const handled = useRef(false);

  const handleScan = (barcode: string) => {
    if (handled.current) return;
    handled.current = true;
    onScanned(barcode);
  };

  const close = () => {
    handled.current = false;
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        <CameraBarcodeView
          onBarcode={handleScan}
          onClose={close}
          permissionTexts={{
            needed: t("barcodeScanner.cameraNeeded"),
            allow: t("barcodeScanner.allowCamera"),
            cancel: t("barcodeScanner.cancel"),
          }}
        >
          <View style={styles.overlay} pointerEvents="box-none">
            <Text style={styles.hint}>{t("barcodeScanner.pointCamera")}</Text>
            <BigButton label={t("barcodeScanner.cancel")} variant="secondary" onPress={close} />
          </View>
        </CameraBarcodeView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, gap: 12 },
  hint: { color: colors.white, fontSize: 16, textAlign: "center" },
});
