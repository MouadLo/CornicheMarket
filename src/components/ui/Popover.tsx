import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { colors, radius } from "@/src/theme/tokens";

// A small menu opened from a button (account, sync status, "More"). It sits at
// the end edge under the top bar; a tap anywhere else closes it. Nothing with
// a Save button belongs here: use a dialog or a panel.
export function Popover({
  visible,
  onClose,
  children,
  top = 64,
  width = 360,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  top?: number;
  width?: number;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="close" />
      <View style={[styles.card, { top, width }]} accessibilityViewIsModal>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    end: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    overflow: "hidden",
    shadowColor: colors.ink900,
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
});
