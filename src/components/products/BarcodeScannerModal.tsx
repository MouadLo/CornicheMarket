import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { colors } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (barcode: string) => void;
};

export function BarcodeScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
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
        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.message}>Camera access is needed to scan barcodes.</Text>
            <BigButton label="Allow camera" onPress={requestPermission} />
            <BigButton label="Cancel" variant="secondary" onPress={close} />
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
            <View style={styles.overlay}>
              <Text style={styles.hint}>Point the camera at the barcode</Text>
              <BigButton label="Cancel" variant="secondary" onPress={close} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  message: { color: colors.white, fontSize: 16, textAlign: "center", marginBottom: 12 },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, gap: 12 },
  hint: { color: colors.white, fontSize: 16, textAlign: "center" },
});
